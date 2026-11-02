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

    // ---------------------------------------------------------------
    // Converting a rendered table into the model (import, older decks)
    // ---------------------------------------------------------------

    function round2(value) {
        return Math.round(value * 100) / 100;
    }

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
