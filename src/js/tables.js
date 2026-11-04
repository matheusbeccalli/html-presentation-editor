/*
 * tables.js - tables on slides (SPEC Phase 4).
 *
 * The table model (deck format 3):
 *
 *   <div class="el" data-type="table" data-id="e3" style="left; top; width; height; z-index">
 *     <table [data-header-row] [data-banded-rows] [data-total-row] [data-first-column]>
 *       <colgroup><col style="width: 240px"> …</colgroup>
 *       <tbody>
 *         <tr style="height: 40px">
 *           <td [colspan] [rowspan] [style="fill, borders, padding, vertical-align, text look"]>
 *             …lines of the text model (text.js)…
 *           </td> …
 *         </tr> …
 *       </tbody>
 *     </table>
 *   </div>
 *
 * - Only <td>, in one <tbody>: like PowerPoint, a header row is a table style
 *   option, not another kind of cell, so switching it on and off changes no cells.
 * - The style options are drawn by the deck's <style data-deck-table> (deckTableCss)
 *   from the theme variables. What is set on one cell is inline on its <td> and wins.
 * - The text in a cell is the same flat-paragraph model as in a text box, and only
 *   text.js touches it (SPEC 3.7). This file handles the grid around it: rows,
 *   columns, merged cells and widths.
 *
 * fromRendered converts a table the browser has laid out (the importer's measuring
 * iframe) into the model, keeping its look: older decks are migrated on open.
 *
 * Talks to: text.js (cell text, theme colours), normalize.js and importer.js
 *           (import, the stylesheet), serialize.js (cells normalized on save).
 */

(function () {
    'use strict';

    App.tables = {};

    // Every cell of every model table in a document or element.
    App.tables.CELL_SELECTOR = '.el[data-type="table"] > table > tbody > tr > td';

    // A cell's box when neither its table (a --cell-… variable) nor the cell itself says otherwise:
    // a thin line under each row, like a simple finance table.
    const CELL_DEFAULTS = {
        '--cell-padding': '4px 8px',
        '--cell-vertical-align': 'top',
        '--cell-border-top': 'none',
        '--cell-border-right': 'none',
        '--cell-border-bottom': '1px solid var(--table-line-color, #D9D9D9)',
        '--cell-border-left': 'none',
    };

    // ---------------------------------------------------------------
    // The deck's table stylesheet
    // ---------------------------------------------------------------

    /*
     * The <style data-deck-table> stylesheet. The deck's own CSS comes before it,
     * and these selectors are more specific than a deck's "td { … }", so a deck
     * cannot restyle model tables by accident. A theme may set the --table-…
     * variables; unset, they fall back to the theme colours.
     */
    App.tables.deckTableCss = function deckTableCss() {
        const table = '.el[data-type="table"] > table';
        const cell = table + ' > tbody > tr > td';
        const rows = (options) => table + options + ' > tbody > tr';
        const fill = 'var(--table-band-fill, #F2F2F2)';
        return [
            '/* Tables (written by the editor): the grid, and the table style options on <table>. */',
            table + ' { width: 100%; table-layout: fixed; border-collapse: collapse; border-spacing: 0; border: 0;' +
            ' margin: 0; background: none; font-family: var(--font-body); font-size: 14pt; color: var(--color-text);' +
            ' line-height: 1.2; text-align: left; }',
            table + ' > tbody > tr { border: 0; background: none; }',
            // A cell inherits its text look from the table; its box comes from the --cell-… variables a
            // table may set for all its cells (CELL_DEFAULTS), and a cell's own inline style wins over both.
            cell + ' { font: inherit; color: inherit; text-align: inherit; background: none; overflow-wrap: break-word;' +
            ' padding: var(--cell-padding, ' + CELL_DEFAULTS['--cell-padding'] + ');' +
            ' vertical-align: var(--cell-vertical-align, ' + CELL_DEFAULTS['--cell-vertical-align'] + ');' +
            ' border-top: var(--cell-border-top, ' + CELL_DEFAULTS['--cell-border-top'] + ');' +
            ' border-right: var(--cell-border-right, ' + CELL_DEFAULTS['--cell-border-right'] + ');' +
            ' border-bottom: var(--cell-border-bottom, ' + CELL_DEFAULTS['--cell-border-bottom'] + ');' +
            ' border-left: var(--cell-border-left, ' + CELL_DEFAULTS['--cell-border-left'] + '); }',
            // Banded rows: every other body row, starting with the first row under the header.
            rows('[data-banded-rows]:not([data-header-row])') + ':nth-child(odd) > td { background: ' + fill + '; }',
            rows('[data-banded-rows][data-header-row]') + ':nth-child(even) > td { background: ' + fill + '; }',
            rows('[data-header-row]') + ':first-child > td { background: var(--table-header-fill, var(--color-accent, #1F2A44));' +
            ' color: var(--table-header-color, #FFFFFF); font-weight: bold; }',
            rows('[data-total-row]') + ':last-child:not(:first-child) > td { font-weight: bold; background: none;' +
            ' border-top: 2px solid var(--table-total-line-color, var(--color-text, #222222)); }',
            rows('[data-first-column]') + ' > td:first-child { font-weight: bold; }',
            // A column of numbers (alignNumbers); an alignment set on the cell or its lines wins.
            cell + '[data-numeric] { text-align: right; }',
        ].join('\n') + '\n';
    };

    // ---------------------------------------------------------------
    // The grid: which cell covers which slot
    // ---------------------------------------------------------------

    /*
     * The table as a full grid of slots: cells[r][c] is the <td>/<th> that covers
     * row r, column c (a merged cell covers several slots), or null where a short
     * row leaves a hole. Returns { rows, cols, cells }.
     */
    App.tables.gridOf = function gridOf(table) {
        const rows = Array.from(table.rows);
        const cells = rows.map(() => []);
        rows.forEach((row, r) => {
            let c = 0;
            Array.from(row.cells).forEach((cell) => {
                while (cells[r][c]) {
                    c += 1;   // a slot taken by a rowspan from above
                }
                // rowspan="0" means "to the end"; a span never reaches past the table.
                const rowSpan = Math.min(cell.rowSpan || rows.length, rows.length - r);
                const colSpan = Math.max(1, cell.colSpan);
                for (let dr = 0; dr < rowSpan; dr++) {
                    for (let dc = 0; dc < colSpan; dc++) {
                        cells[r + dr][c + dc] = cell;
                    }
                }
                c += colSpan;
            });
        });
        const cols = cells.reduce((most, row) => Math.max(most, row.length), 0);
        cells.forEach((row) => {
            for (let c = 0; c < cols; c++) {
                row[c] = row[c] || null;
            }
        });
        return { rows: rows.length, cols: cols, cells: cells };
    };

    function round2(value) {
        return Math.round(value * 100) / 100;
    }

    /* `total` split into `count` parts of two decimals that add up exactly (the last one takes the rest). */
    function splitEvenly(total, count) {
        const part = Math.floor(total / count * 100) / 100;
        const parts = new Array(count).fill(part);
        parts[count - 1] = round2(total - part * (count - 1));
        return parts;
    }

    /* Scale `values` to add up to `total`, keeping their proportions; again the last one takes the rest. */
    function scaleTo(values, total) {
        const sum = values.reduce((a, b) => a + b, 0);
        if (sum <= 0) {
            return splitEvenly(total, values.length);
        }
        const scaled = values.map((value) => round2(value * total / sum));
        scaled[scaled.length - 1] = round2(total - scaled.slice(0, -1).reduce((a, b) => a + b, 0));
        return scaled;
    }

    // ---------------------------------------------------------------
    // New tables (Insert > Table)
    // ---------------------------------------------------------------

    const NEW_TABLE_WIDTH = 960;   // px: three quarters of the slide, as PowerPoint's inserted tables
    const NEW_ROW_HEIGHT = 40;     // px: room for a line of the 14pt default text

    /* Where a new table of `rows` x `cols` goes: centred on the 1280x720 slide. */
    App.tables.newTableRect = function newTableRect(rows, cols) {
        const height = rows * NEW_ROW_HEIGHT;
        return {
            left: (1280 - NEW_TABLE_WIDTH) / 2,
            top: Math.max(0, Math.round((720 - height) / 2)),
            width: NEW_TABLE_WIDTH,
            height: height,
        };
    };

    /*
     * A new, empty table element of `rows` x `cols` at rect { left, top, width, height }
     * (slide px), equal columns and rows, with PowerPoint's default style options:
     * a header row and banded rows. Every cell has one empty line to type in.
     */
    App.tables.createTable = function createTable(doc, rows, cols, rect, id) {
        const element = doc.createElement('div');
        element.setAttribute('class', 'el');
        element.setAttribute('data-type', 'table');
        if (id) {
            element.setAttribute('data-id', id);
        }
        ['left', 'top', 'width', 'height'].forEach((side) => element.style.setProperty(side, rect[side] + 'px'));

        const table = doc.createElement('table');
        table.setAttribute('data-header-row', '');
        table.setAttribute('data-banded-rows', '');
        const columns = doc.createElement('colgroup');
        splitEvenly(rect.width, cols).forEach((width) => {
            const col = doc.createElement('col');
            col.style.setProperty('width', width + 'px');
            columns.appendChild(col);
        });
        const body = doc.createElement('tbody');
        splitEvenly(rect.height, rows).forEach((height) => {
            const row = doc.createElement('tr');
            row.style.setProperty('height', height + 'px');
            for (let c = 0; c < cols; c++) {
                row.appendChild(emptyCell(doc));
            }
            body.appendChild(row);
        });
        table.append(columns, body);
        element.appendChild(table);
        return element;
    };

    // ---------------------------------------------------------------
    // Fitting a table to its box (resize)
    // ---------------------------------------------------------------

    /*
     * Make the table fit its element's box after an edit, or after a resize
     * (options.resized): the columns scale to the box's width; after a resize
     * the rows scale to its new height too, keeping their proportions. A row's
     * height is its minimum: the browser draws it taller when its text needs
     * it, and it goes back when the text is gone, as in PowerPoint. Either way
     * the box then takes the rows' real height. Needs the slide to be shown
     * (it measures). Returns true when something changed.
     */
    App.tables.fitTable = function fitTable(element, options) {
        const table = element && element.getAttribute('data-type') === 'table' ? element.querySelector(':scope > table') : null;
        if (!table) {
            return false;
        }
        const cols = Array.from(table.querySelectorAll(':scope > colgroup > col'));
        const rows = Array.from(table.rows);
        const before = sizesOf(element, cols, rows);

        const width = parseFloat(element.style.width);
        if (cols.length > 0 && width > 0) {
            scaleTo(cols.map((col) => parseFloat(col.style.width) || 0), width)
                .forEach((value, index) => cols[index].style.setProperty('width', value + 'px'));
        }
        const height = parseFloat(element.style.height);
        if (options && options.resized && rows.length > 0 && height > 0) {
            scaleTo(rows.map((row) => parseFloat(row.style.height) || 0), height)
                .forEach((value, index) => rows[index].style.setProperty('height', value + 'px'));
        }
        if (table.getBoundingClientRect().height > 0) {   // laid out: the box is as tall as the rows drawn
            // The rows, not the table: half of the last row's bottom line hangs below it (collapsed borders).
            const drawn = rows.reduce((sum, row) => sum + row.getBoundingClientRect().height, 0);
            element.style.setProperty('height', round2(drawn) + 'px');
        }
        return sizesOf(element, cols, rows) !== before;
    };

    function sizesOf(element, cols, rows) {
        return [element.style.height].concat(cols.map((col) => col.style.width), rows.map((row) => row.style.height)).join();
    }

    // ---------------------------------------------------------------
    // Column borders
    // ---------------------------------------------------------------

    /* The column widths of a table, from its colgroup (slide px). */
    App.tables.colWidths = function colWidths(table) {
        return Array.from(table.querySelectorAll(':scope > colgroup > col'), (col) => parseFloat(col.style.width) || 0);
    };

    App.tables.setColumnWidths = function setColumnWidths(table, widths) {
        table.querySelectorAll(':scope > colgroup > col').forEach((col, index) => col.style.setProperty('width', widths[index] + 'px'));
    };

    /*
     * The widths after dragging inner border `border` (between columns border - 1
     * and border) by dx px, as in PowerPoint: the column left of it gives or
     * takes width from the one right of it, the table keeps its width, and
     * neither gets narrower than `min`.
     */
    App.tables.resizeColumn = function resizeColumn(widths, border, dx, min) {
        const left = widths[border - 1];
        const right = widths[border];
        const step = Math.max(Math.min(round2(dx), right - min), min - left);
        const next = widths.slice();
        next[border - 1] = round2(left + step);
        next[border] = round2(right - step);
        return next;
    };

    /*
     * The inner column border within `tolerance` px of point (x, y) of a laid-out
     * table element (slide px, as the deck shows them), or -1. Only where a cell
     * edge is drawn: not across a cell merged over the border. The outer edges
     * are not column borders (the edge moves the table, the handles resize it).
     */
    App.tables.columnBorderAt = function columnBorderAt(element, x, y, tolerance) {
        const table = element.querySelector(':scope > table');
        const rect = table ? table.getBoundingClientRect() : null;
        if (!rect || y < rect.top || y > rect.bottom) {
            return -1;
        }
        const row = Array.from(table.rows).findIndex((tr) => y <= tr.getBoundingClientRect().bottom);
        const widths = App.tables.colWidths(table);
        let edge = rect.left;
        for (let border = 1; border < widths.length; border++) {
            edge += widths[border - 1];
            const across = App.tables.cellBoxes(table).some((box) =>
                box.row <= row && row < box.row + box.rowSpan && box.col < border && border < box.col + box.colSpan);
            if (Math.abs(x - edge) <= tolerance && !across) {
                return border;
            }
        }
        return -1;
    };

    // ---------------------------------------------------------------
    // Rows and cells
    // ---------------------------------------------------------------

    /*
     * Add a row at the end, like the last one: its height and, per column, the
     * look of the cell above (fill, borders, merged across), with empty text.
     * A cell merged down into the last row ends there; the new row gets a cell
     * of its own in that column. Returns the new <tr>.
     */
    App.tables.appendRow = function appendRow(table) {
        const grid = App.tables.gridOf(table);
        const last = table.rows[table.rows.length - 1];
        const row = table.ownerDocument.createElement('tr');
        if (last.style.height) {
            row.style.setProperty('height', last.style.height);
        }
        const above = grid.cells[grid.rows - 1];
        above.forEach((cell, c) => {
            if (cell && c > 0 && above[c - 1] === cell) {
                return;   // the rest of a cell merged across: already covered
            }
            const copy = cell ? cell.cloneNode(false) : table.ownerDocument.createElement('td');
            copy.removeAttribute('rowspan');
            App.text.normalizeCell(copy);
            row.appendChild(copy);
        });
        last.parentElement.appendChild(row);
        return row;
    };

    // ---------------------------------------------------------------
    // Blocks of cells; inserting, deleting, merging, splitting (Layout tab)
    // ---------------------------------------------------------------
    //
    // These work on the grid of slots (gridOf): row and column numbers count
    // slots, so a merged cell is at the row and column of its top-left slot.
    // A block is { top, left, bottom, right }, inclusive.

    /* Every cell with the slot it starts at and its spans: [{ cell, row, col, rowSpan, colSpan }] in reading order. */
    App.tables.cellBoxes = function cellBoxes(table) {
        const grid = App.tables.gridOf(table);
        const boxes = new Map();
        grid.cells.forEach((slots, r) => slots.forEach((cell, c) => {
            if (!cell) {
                return;
            }
            const box = boxes.get(cell);
            if (!box) {
                boxes.set(cell, { cell: cell, row: r, col: c, rowSpan: 1, colSpan: 1 });
            } else {
                box.rowSpan = Math.max(box.rowSpan, r - box.row + 1);
                box.colSpan = Math.max(box.colSpan, c - box.col + 1);
            }
        }));
        return Array.from(boxes.values());
    };

    function overlaps(box, block) {
        return box.row <= block.bottom && box.row + box.rowSpan - 1 >= block.top &&
            box.col <= block.right && box.col + box.colSpan - 1 >= block.left;
    }

    /*
     * The block from slot `a` to slot `b` ({ row, col }), grown until no merged
     * cell sticks out of it (as PowerPoint selects cells).
     */
    App.tables.blockAround = function blockAround(table, a, b) {
        const block = { top: Math.min(a.row, b.row), left: Math.min(a.col, b.col),
            bottom: Math.max(a.row, b.row), right: Math.max(a.col, b.col) };
        const boxes = App.tables.cellBoxes(table);
        let grown = true;
        while (grown) {
            grown = false;
            boxes.filter((box) => overlaps(box, block)).forEach((box) => {
                const edges = { top: box.row, left: box.col, bottom: box.row + box.rowSpan - 1, right: box.col + box.colSpan - 1 };
                ['top', 'left'].forEach((side) => {
                    if (edges[side] < block[side]) {
                        block[side] = edges[side];
                        grown = true;
                    }
                });
                ['bottom', 'right'].forEach((side) => {
                    if (edges[side] > block[side]) {
                        block[side] = edges[side];
                        grown = true;
                    }
                });
            });
        }
        return block;
    };

    /* The block a single cell covers. */
    App.tables.blockOf = function blockOf(cell) {
        const box = App.tables.cellBoxes(cell.closest('table')).find((item) => item.cell === cell);
        return { top: box.row, left: box.col, bottom: box.row + box.rowSpan - 1, right: box.col + box.colSpan - 1 };
    };

    function setSpan(cell, name, value) {
        if (value > 1) {
            cell.setAttribute(name, String(value));
        } else {
            cell.removeAttribute(name);
        }
    }

    /* An empty cell with the look of `model` (fill, borders …) but none of its spans. */
    function emptyCellLike(model, doc) {
        const cell = model ? model.cloneNode(false) : doc.createElement('td');
        cell.removeAttribute('rowspan');
        cell.removeAttribute('colspan');
        App.text.normalizeCell(cell);
        return cell;
    }

    /*
     * Put `cell` into row `rowIndex` so that it starts at slot column `col`:
     * before the first cell that starts in that row further right. `boxes` are
     * the cell boxes from before any change, so several cells can be placed in turn.
     */
    function placeCell(table, boxes, rowIndex, col, cell) {
        const after = boxes.filter((box) => box.row === rowIndex && box.col > col && box.cell.parentElement === table.rows[rowIndex])
            .sort((x, y) => x.col - y.col)[0];
        table.rows[rowIndex].insertBefore(cell, after ? after.cell : null);
    }

    /*
     * Insert `count` empty rows before slot row `at` (at = the number of rows: at
     * the end). Each new row has the height of row `model` and its cells' look.
     * A cell merged down across the place where the rows go gets taller instead.
     */
    App.tables.insertRows = function insertRows(table, at, count, model) {
        const doc = table.ownerDocument;
        const grid = App.tables.gridOf(table);
        const across = new Set();
        const created = [];
        for (let k = 0; k < count; k++) {
            const row = doc.createElement('tr');
            if (table.rows[model].style.height) {
                row.style.setProperty('height', table.rows[model].style.height);
            }
            for (let c = 0; c < grid.cols; c++) {
                const spanning = at > 0 && at < grid.rows && grid.cells[at - 1][c] && grid.cells[at - 1][c] === grid.cells[at][c];
                if (spanning) {
                    across.add(grid.cells[at][c]);
                } else {
                    row.appendChild(emptyCellLike(grid.cells[model][c], doc));
                }
            }
            created.push(row);
        }
        const before = table.rows[at] || null;
        created.forEach((row) => (before ? before.parentElement.insertBefore(row, before) : table.tBodies[0].appendChild(row)));
        across.forEach((cell) => setSpan(cell, 'rowspan', cell.rowSpan + count));
        return created;
    };

    /*
     * Insert `count` empty columns before slot column `at`, each as wide as
     * column `model` and with its cells' look. A cell merged across the place
     * where the columns go gets wider instead. The table gets wider.
     */
    App.tables.insertColumns = function insertColumns(table, at, count, model) {
        const doc = table.ownerDocument;
        const grid = App.tables.gridOf(table);
        const boxes = App.tables.cellBoxes(table);
        const cols = Array.from(table.querySelectorAll(':scope > colgroup > col'));
        if (cols.length > 0) {
            for (let k = 0; k < count; k++) {
                const col = doc.createElement('col');
                if (cols[model] && cols[model].style.width) {
                    col.style.setProperty('width', cols[model].style.width);
                }
                cols[0].parentElement.insertBefore(col, cols[at] || null);
            }
        }
        const across = new Set();
        for (let r = 0; r < grid.rows; r++) {
            const spanning = at > 0 && at < grid.cols && grid.cells[r][at - 1] && grid.cells[r][at - 1] === grid.cells[r][at];
            if (spanning) {
                across.add(grid.cells[r][at]);
                continue;
            }
            for (let k = 0; k < count; k++) {
                placeCell(table, boxes, r, at - 0.5, emptyCellLike(grid.cells[r][model], doc));
            }
        }
        across.forEach((cell) => setSpan(cell, 'colspan', cell.colSpan + count));
    };

    /*
     * Delete slot rows `top` … `bottom`. A merged cell reaching into them from
     * above gets shorter; one that starts in them and goes on below moves down
     * to the first row left under them.
     */
    App.tables.deleteRows = function deleteRows(table, top, bottom) {
        const boxes = App.tables.cellBoxes(table);
        boxes.forEach((box) => {
            const end = box.row + box.rowSpan - 1;
            const overlap = Math.min(end, bottom) - Math.max(box.row, top) + 1;
            if (overlap <= 0 || (box.row >= top && end <= bottom)) {
                return;   // untouched, or gone with its row
            }
            setSpan(box.cell, 'rowspan', box.rowSpan - overlap);
            if (box.row >= top) {
                placeCell(table, boxes, bottom + 1, box.col, box.cell);
            }
        });
        for (let r = bottom; r >= top; r--) {
            table.rows[r].remove();
        }
    };

    /* Delete slot columns `left` … `right`; a cell merged across them gets narrower. The table gets narrower. */
    App.tables.deleteColumns = function deleteColumns(table, left, right) {
        App.tables.cellBoxes(table).forEach((box) => {
            const end = box.col + box.colSpan - 1;
            const overlap = Math.min(end, right) - Math.max(box.col, left) + 1;
            if (overlap <= 0) {
                return;
            }
            if (box.col >= left && end <= right) {
                box.cell.remove();
            } else {
                setSpan(box.cell, 'colspan', box.colSpan - overlap);
            }
        });
        const cols = Array.from(table.querySelectorAll(':scope > colgroup > col'));
        cols.slice(left, right + 1).forEach((col) => col.remove());
    };

    /*
     * Merge a block into its top-left cell, as PowerPoint does: the lines of the
     * other cells (empty ones add nothing) follow in reading order. Returns the cell.
     */
    App.tables.mergeCells = function mergeCells(table, block) {
        const inside = App.tables.cellBoxes(table).filter((box) => overlaps(box, block));
        const first = inside[0].cell;
        const hasText = (cell) => cell.textContent.trim() !== '';
        if (!hasText(first)) {
            first.replaceChildren();
        }
        inside.slice(1).forEach((box) => {
            if (hasText(box.cell)) {
                first.append(...Array.from(box.cell.childNodes));
            }
            box.cell.remove();
        });
        setSpan(first, 'rowspan', block.bottom - block.top + 1);
        setSpan(first, 'colspan', block.right - block.left + 1);
        App.text.normalizeCell(first);
        return first;
    };

    /* Split a merged cell back into one cell per slot; its text stays in the first, the others are empty with its look. */
    App.tables.splitCell = function splitCell(table, cell) {
        const boxes = App.tables.cellBoxes(table);
        const box = boxes.find((item) => item.cell === cell);
        for (let r = box.row; r < box.row + box.rowSpan; r++) {
            for (let c = box.col; c < box.col + box.colSpan; c++) {
                if (r !== box.row || c !== box.col) {
                    placeCell(table, boxes, r, c, emptyCellLike(cell, table.ownerDocument));
                }
            }
        }
        cell.removeAttribute('rowspan');
        cell.removeAttribute('colspan');
    };

    // ---------------------------------------------------------------
    // Cell look: fill, borders, padding, vertical alignment (Table Design, Layout)
    // ---------------------------------------------------------------

    /* The cells of a block of slots, each once, in reading order. */
    App.tables.cellsIn = function cellsIn(table, block) {
        return App.tables.cellBoxes(table).filter((box) => overlaps(box, block)).map((box) => box.cell);
    };

    /* The block of every slot of a table. */
    App.tables.wholeBlock = function wholeBlock(table) {
        const grid = App.tables.gridOf(table);
        return { top: 0, left: 0, bottom: grid.rows - 1, right: grid.cols - 1 };
    };

    /* A cell's inline style, without leaving an empty style="" behind. */
    function setCellStyle(cell, property, value) {
        if (value === null) {
            cell.style.removeProperty(property);
        } else {
            cell.style.setProperty(property, value);
        }
        if (!cell.getAttribute('style')) {
            cell.removeAttribute('style');
        }
    }

    /* Fill cells with a colour (theme colours as var(--color-…)); null gives them back to the table style. */
    App.tables.setFill = function setFill(cells, value) {
        cells.forEach((cell) => setCellStyle(cell, 'background-color', value));
    };

    const FACING = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

    // Which sides of a cell a kind of border draws: outer = on the block's outline.
    const BORDER_KINDS = {
        all: () => true,
        none: () => true,
        outside: (side, outer) => outer,
        inside: (side, outer) => !outer,
        insideHorizontal: (side, outer) => !outer && (side === 'top' || side === 'bottom'),
        insideVertical: (side, outer) => !outer && (side === 'left' || side === 'right'),
        top: (side, outer) => outer && side === 'top',
        bottom: (side, outer) => outer && side === 'bottom',
        left: (side, outer) => outer && side === 'left',
        right: (side, outer) => outer && side === 'right',
    };

    /*
     * Draw borders of a block of cells with `value` (a CSS border such as
     * "1px solid #000000"; "none" removes them). kind: a key of BORDER_KINDS, as
     * PowerPoint's Borders list. Borders collapse, so a line is written on both
     * cells it runs between (the cell outside the block too): neither one wins.
     */
    App.tables.setBorders = function setBorders(table, block, kind, value) {
        const grid = App.tables.gridOf(table);
        const draws = BORDER_KINDS[kind];
        App.tables.cellBoxes(table).filter((box) => overlaps(box, block)).forEach((box) => {
            const bottom = box.row + box.rowSpan - 1;
            const right = box.col + box.colSpan - 1;
            const sides = {
                top: { outer: box.row === block.top, slots: range(box.col, right).map((c) => [box.row - 1, c]) },
                bottom: { outer: bottom === block.bottom, slots: range(box.col, right).map((c) => [bottom + 1, c]) },
                left: { outer: box.col === block.left, slots: range(box.row, bottom).map((r) => [r, box.col - 1]) },
                right: { outer: right === block.right, slots: range(box.row, bottom).map((r) => [r, right + 1]) },
            };
            Object.keys(sides).filter((side) => draws(side, sides[side].outer)).forEach((side) => {
                setCellStyle(box.cell, 'border-' + side, value);
                const facing = new Set(sides[side].slots.map(([r, c]) => (grid.cells[r] || [])[c]).filter(Boolean));
                facing.forEach((cell) => setCellStyle(cell, 'border-' + FACING[side], value));
            });
        });
    };

    function range(from, to) {
        const values = [];
        for (let value = from; value <= to; value++) {
            values.push(value);
        }
        return values;
    }

    /*
     * Padding or vertical alignment ('padding' | 'vertical-align') for some
     * cells, or for all of them (cells = null): then once on the table, as its
     * --cell-… variable (not written when it is the default), and the cells'
     * own values go.
     */
    App.tables.setCellBox = function setCellBox(table, cells, property, value) {
        if (cells) {
            cells.forEach((cell) => setCellStyle(cell, property, value));
            return;
        }
        const variable = '--cell-' + property;
        if (CELL_DEFAULTS[variable] === value) {
            table.style.removeProperty(variable);
        } else {
            table.style.setProperty(variable, value);
        }
        table.querySelectorAll(':scope > tbody > tr > td').forEach((cell) => setCellStyle(cell, property, null));
    };

    // ---------------------------------------------------------------
    // Numbers in cells
    // ---------------------------------------------------------------
    //
    // A column of numbers is right-aligned, as in Excel: alignNumbers marks
    // its cells data-numeric (header included, so it lines up with them) and
    // the deck's stylesheet aligns them. An alignment chosen on the cell or
    // its lines wins. The number buttons rewrite the text (numbers.js).

    /* A cell's text when it is one line (without the spaces around it), or null. */
    function oneLine(cell) {
        const lines = App.text.lineTexts(cell).map((line) => line.trim()).filter((line) => line !== '');
        return lines.length <= 1 ? (lines[0] || '') : null;
    }

    /*
     * Mark the cells of the number columns: a column (cells merged across
     * columns aside) whose cells under the first row hold a number, and
     * otherwise nothing, a dash or n.a. (App.numbers.isBlank). Returns
     * whether a mark changed.
     */
    App.tables.alignNumbers = function alignNumbers(table) {
        const boxes = App.tables.cellBoxes(table);
        const numeric = new Map();
        const isNumberColumn = (col) => {
            if (!numeric.has(col)) {
                const texts = boxes.filter((box) => box.col === col && box.colSpan === 1 && box.row > 0).map((box) => oneLine(box.cell));
                const counts = (text) => text !== null && !App.numbers.isBlank(text);
                numeric.set(col, texts.some(counts) &&
                    texts.every((text) => !counts(text) ? text !== null : App.numbers.parse(text) !== null));
            }
            return numeric.get(col);
        };
        let changed = false;
        boxes.forEach((box) => {
            const on = box.colSpan === 1 && isNumberColumn(box.col);
            if (box.cell.hasAttribute('data-numeric') !== on) {
                box.cell.toggleAttribute('data-numeric', on);
                changed = true;
            }
        });
        return changed;
    };

    /* The locale the table's numbers are clearly written in (App.numbers.localeShown), or null. */
    App.tables.numberLocaleOf = function numberLocaleOf(table) {
        return App.numbers.localeShown(Array.from(table.querySelectorAll(':scope > tbody > tr > td')).map(oneLine).filter((text) => text));
    };

    /* The cells of `cells` that hold one number: [{ cell, number }] (number: App.numbers.parse, read in `locale`). */
    App.tables.numbersIn = function numbersIn(cells, locale) {
        return cells.map((cell) => {
            const text = oneLine(cell);
            return { cell: cell, number: text ? App.numbers.parse(text, locale) : null };
        }).filter((found) => found.number !== null);
    };

    /*
     * Rewrite the number in each of `cells` (read in `readLocale`) as
     * change(number) returns it (null: leave it), written in `writeLocale`.
     * The new text takes the look of the old one's first character.
     */
    App.tables.formatNumbers = function formatNumbers(cells, readLocale, writeLocale, change) {
        App.tables.numbersIn(cells, readLocale).forEach((found) => {
            const next = change(found.number);
            if (!next) {
                return;
            }
            const lines = App.text.lineTexts(found.cell);
            const p = lines.findIndex((line) => line.trim() !== '');
            const start = lines[p].indexOf(lines[p].trim());
            App.text.replaceAll(found.cell, [{ p: p, start: start, end: start + lines[p].trim().length }],
                App.numbers.format(next, writeLocale));
        });
    };

    /* The cell of a table element under slide point (x, y), or null (the slide must be shown). */
    App.tables.cellAt = function cellAt(element, x, y) {
        const hit = element.ownerDocument.elementFromPoint(x, y);
        const cell = hit && hit.closest('td');
        return cell && element.contains(cell) ? cell : null;
    };

    /* The cell `step` places after `cell` (-1: before it) in reading order, or null at either end. */
    App.tables.nextCell = function nextCell(cell, step) {
        const cells = Array.from(cell.closest('tbody').querySelectorAll(':scope > tr > td'));
        return cells[cells.indexOf(cell) + step] || null;
    };

    /* The first cell of a table element, in reading order. */
    App.tables.firstCell = function firstCell(element) {
        return element.querySelector(':scope > table > tbody > tr > td');
    };

    // ---------------------------------------------------------------
    // Converting a rendered table into the model (import, older decks)
    // ---------------------------------------------------------------

    function isTransparent(color) {
        return !color || color === 'transparent' || /rgba\(.*,\s*0\)$/.test(color);
    }

    /* Each column's width: a cell that spans only that column says it; failing that, a share of a merged one. */
    function columnWidths(grid, scale) {
        const widths = [];
        for (let c = 0; c < grid.cols; c++) {
            const column = grid.cells.map((row) => row[c]).filter(Boolean);
            const single = column.find((cell) => cell.colSpan === 1);
            const cell = single || column[0];
            widths.push(cell ? round2(cell.getBoundingClientRect().width / (single ? 1 : cell.colSpan) * scale) : 0);
        }
        return widths;
    }

    /* The widths of a laid-out table's columns, in px (paste from Excel). */
    App.tables.renderedColumnWidths = function renderedColumnWidths(table) {
        return columnWidths(App.tables.gridOf(table), 1);
    };

    /* A cell's fill: its own, else the row's, the row group's or the table's (the cell is drawn on top of them). */
    function backgroundOf(sourceCell, table) {
        const view = table.ownerDocument.defaultView;
        for (let node = sourceCell; node; node = node.parentElement) {
            const color = view.getComputedStyle(node).backgroundColor;
            if (!isTransparent(color)) {
                return color;
            }
            if (node === table) {
                break;
            }
        }
        return null;
    }

    function borderText(computed, side, scale) {
        const width = parseFloat(computed.getPropertyValue('border-' + side + '-width')) || 0;
        const style = computed.getPropertyValue('border-' + side + '-style');
        if (width === 0 || style === 'none' || style === 'hidden') {
            return null;
        }
        return round2(width * scale) + 'px ' + style + ' ' + computed.getPropertyValue('border-' + side + '-color');
    }

    /*
     * Fill, borders, padding and vertical alignment, written inline on the new cell.
     * Every side is written, "none" too: the stylesheet's default line under each
     * row must not appear where the deck had none (liftCommonLook then moves what
     * most cells share onto the table). A border set on the row (allowed when
     * borders collapse) is moved onto its cells.
     */
    function writeCellBox(cell, sourceCell, table, scale) {
        const view = sourceCell.ownerDocument.defaultView;
        const computed = view.getComputedStyle(sourceCell);
        const rowComputed = view.getComputedStyle(sourceCell.parentElement);

        const background = backgroundOf(sourceCell, table);
        if (background) {
            cell.style.setProperty('background-color', App.text.themeColorOf(background, sourceCell.ownerDocument));
        }
        const sides = ['top', 'right', 'bottom', 'left'].map((side) => {
            const own = borderText(computed, side, scale);
            const fromRow = side === 'top' || side === 'bottom' ? borderText(rowComputed, side, scale) : null;
            return own || fromRow || 'none';
        });
        ['top', 'right', 'bottom', 'left'].forEach((side, index) => {
            cell.style.setProperty('border-' + side, sides[index]);
        });
        const padding = ['top', 'right', 'bottom', 'left'].map((side) => {
            return round2((parseFloat(computed.getPropertyValue('padding-' + side)) || 0) * scale) + 'px';
        });
        cell.style.setProperty('padding', padding.join(' '));
        const align = computed.verticalAlign;
        cell.style.setProperty('vertical-align', align === 'middle' || align === 'bottom' ? align : 'top');
    }

    function convertCell(sourceCell, doc, table, scale) {
        const cell = doc.createElement('td');
        if (sourceCell.colSpan > 1) {
            cell.setAttribute('colspan', String(sourceCell.colSpan));
        }
        // rowspan="0" means "to the end"; either way a span stops at the last row.
        const rowsLeft = table.rows.length - sourceCell.parentElement.rowIndex;
        const rowSpan = Math.min(sourceCell.rowSpan || rowsLeft, rowsLeft);
        if (rowSpan > 1) {
            cell.setAttribute('rowspan', String(rowSpan));
        }
        App.text.fromRendered(sourceCell, cell, { scale: scale });   // the text look and the lines
        App.text.normalizeCell(cell);
        writeCellBox(cell, sourceCell, table, scale);
        return cell;
    }

    // What a cell may share with the rest of its table: the property on the cell -> where the table keeps it.
    const SHARED_LOOK = {
        'font-family': 'font-family', 'font-size': 'font-size', color: 'color', 'font-weight': 'font-weight',
        'font-style': 'font-style', 'letter-spacing': 'letter-spacing', 'text-transform': 'text-transform',
        'text-align': 'text-align', 'line-height': 'line-height',
        padding: '--cell-padding', 'vertical-align': '--cell-vertical-align',
        'border-top': '--cell-border-top', 'border-right': '--cell-border-right',
        'border-bottom': '--cell-border-bottom', 'border-left': '--cell-border-left',
    };

    /*
     * Like a text box's look (SPEC 3.4): the value most cells have goes on the
     * table once, and only cells that differ keep their own. The text look is
     * inherited from the table; the box values become the table's --cell-…
     * variables (left out when they equal the stylesheet's default).
     */
    function liftCommonLook(table) {
        const cells = Array.from(table.querySelectorAll('td'));
        Object.keys(SHARED_LOOK).forEach((property) => {
            const tally = new Map();
            cells.forEach((cell) => {
                const value = cell.style.getPropertyValue(property);
                tally.set(value, (tally.get(value) || 0) + 1);
            });
            let common = '';
            tally.forEach((count, value) => {
                if (common === '' || count > tally.get(common)) {
                    common = value;
                }
            });
            if (common === '') {
                return;
            }
            const target = SHARED_LOOK[property];
            if (CELL_DEFAULTS[target] !== common) {
                table.style.setProperty(target, common);
            }
            cells.forEach((cell) => {
                if (cell.style.getPropertyValue(property) === common) {
                    cell.style.removeProperty(property);
                }
            });
        });
        cells.filter((cell) => cell.getAttribute('style') === '').forEach((cell) => cell.removeAttribute('style'));
    }

    function emptyCell(doc) {
        const cell = doc.createElement('td');
        App.text.normalizeCell(cell);
        return cell;
    }

    /*
     * Convert `source`, a <table> laid out by the browser, into a model table that
     * replaces the children of `target` (the table element .el in the deck being
     * built). Header cells become ordinary cells that keep their look; the deck's
     * classes are not copied, because everything they did is now inline.
     *   options.scale  slide scale (e.g. 2/3 for a 1920x1080 deck)
     * Returns { caption }: the text of a caption, which the model has no place for.
     */
    App.tables.fromRendered = function fromRendered(source, target, options) {
        const scale = (options && options.scale) || 1;
        const doc = target.ownerDocument;
        const grid = App.tables.gridOf(source);

        const table = doc.createElement('table');
        const columns = doc.createElement('colgroup');
        columnWidths(grid, scale).forEach((width) => {
            const col = doc.createElement('col');
            col.style.setProperty('width', width + 'px');
            columns.appendChild(col);
        });
        table.appendChild(columns);

        const body = doc.createElement('tbody');
        Array.from(source.rows).forEach((sourceRow, r) => {
            const row = doc.createElement('tr');
            row.style.setProperty('height', round2(sourceRow.getBoundingClientRect().height * scale) + 'px');
            Array.from(sourceRow.cells).forEach((sourceCell) => row.appendChild(convertCell(sourceCell, doc, source, scale)));
            // A short row gets empty cells, so every row covers every column.
            grid.cells[r].filter((slot) => slot === null).forEach(() => row.appendChild(emptyCell(doc)));
            body.appendChild(row);
        });
        table.appendChild(body);
        liftCommonLook(table);
        target.replaceChildren(table);

        const caption = source.caption ? source.caption.textContent.trim() : '';
        return { caption: caption };
    };
})();
