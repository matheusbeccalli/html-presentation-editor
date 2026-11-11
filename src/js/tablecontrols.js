/*
 * tablecontrols.js - the table controls of the editor (SPEC Phase 4).
 *
 * Insert > Table opens a 10 x 10 grid, as in PowerPoint: moving the mouse over
 * it picks a size ("4 × 3 table": columns first), a click inserts it. The arrow
 * keys move the pick and Enter inserts it; Esc or a click elsewhere closes it.
 *
 * Selected cells: dragging from one cell to another (or Shift+click while
 * typing in a cell) selects a block of cells, drawn on the overlay (nothing is
 * written into the deck). Esc lets go of it; Delete empties its cells.
 *
 * Column borders: the mouse over an inner border shows the border cursor; a
 * drag moves it, the column left of it giving or taking width from the one
 * right of it (the table keeps its width), as in PowerPoint. It works whether
 * or not a cell is being typed in (typing goes on afterwards); one undo step.
 *
 * The Layout tab (shown while a table is selected) works on the selected cells,
 * or the cell being typed in: insert rows / columns, delete rows / columns /
 * the table, merge, split. Each is one undo step; tables.js changes the grid.
 *
 * Talks to: tables.js (the grid), text.js (the cell being typed in, emptying
 * cells), selection.js (the mouse press that starts in a table), commands.js
 * (insertTable and the Layout commands), ribbon.js (places the controls),
 * history.js, deck.js.
 */

(function () {
    'use strict';

    App.tableControls = {};

    const GRID_SIZE = 10;
    const el = (...args) => App.util.el(...args);

    let tableButton = null;
    let menu = null;    // the open grid, or null
    let pick = null;    // { rows, cols } under the mouse or the arrow keys, or null

    /* The pick after an arrow key, inside 1 … 10 both ways; other keys leave it. */
    App.tableControls.movePick = function movePick(current, key) {
        const step = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[key];
        if (!step) {
            return current;
        }
        const clamp = (value) => Math.max(1, Math.min(GRID_SIZE, value));
        return { rows: clamp(current.rows + step[0]), cols: clamp(current.cols + step[1]) };
    };

    App.tableControls.pickLabel = function pickLabel(size) {
        return size.cols + ' × ' + size.rows + ' table';
    };

    function showPick(next) {
        pick = next;
        menu.querySelector('.table-grid-label').textContent = pick ? App.tableControls.pickLabel(pick) : 'Insert table';
        menu.querySelectorAll('.table-grid-cell').forEach((cell) => {
            const inside = pick && Number(cell.getAttribute('data-row')) <= pick.rows &&
                Number(cell.getAttribute('data-col')) <= pick.cols;
            cell.classList.toggle('picked', !!inside);
        });
    }

    function insertPicked() {
        const size = pick;
        closeGrid();
        if (size) {
            App.commands.run('insertTable', size);
        }
    }

    function closeGrid() {
        if (menu) {
            menu.remove();
            menu = null;
            pick = null;
            window.removeEventListener('pointerdown', onOutsidePointerDown, true);
            tableButton.setAttribute('aria-expanded', 'false');
        }
    }

    function onOutsidePointerDown(event) {
        if (menu && !menu.contains(event.target) && !tableButton.contains(event.target)) {
            closeGrid();
        }
    }

    function onGridKey(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            closeGrid();
            tableButton.focus();
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            insertPicked();
        } else if (/^Arrow/.test(event.key)) {
            event.preventDefault();
            showPick(pick ? App.tableControls.movePick(pick, event.key) : { rows: 1, cols: 1 });
        }
    }

    function openGrid() {
        closeGrid();
        const grid = el('div', { class: 'table-grid', onmouseleave: () => showPick(null) });
        for (let row = 1; row <= GRID_SIZE; row++) {
            for (let col = 1; col <= GRID_SIZE; col++) {
                grid.appendChild(el('div', {
                    class: 'table-grid-cell', 'data-row': String(row), 'data-col': String(col),
                    onmouseenter: () => showPick({ rows: row, cols: col }),
                    onclick: insertPicked,
                }));
            }
        }
        menu = el('div', {
            class: 'menu table-grid-menu', role: 'dialog', 'aria-label': 'Insert table', tabindex: '-1',
            onkeydown: onGridKey,
        }, [el('div', { class: 'table-grid-label' }, ['Insert table']), grid]);
        const rect = tableButton.getBoundingClientRect();
        menu.style.left = rect.left + 'px';
        menu.style.top = rect.bottom + 'px';
        document.body.appendChild(menu);
        tableButton.setAttribute('aria-expanded', 'true');
        window.addEventListener('pointerdown', onOutsidePointerDown, true);
        menu.focus();
    }

    function createInsertTable() {
        tableButton = el('button', {
            type: 'button', class: 'ribbon-button table-button', title: 'Insert a table', 'aria-label': 'Table',
            'aria-haspopup': 'dialog', 'aria-expanded': 'false',
            onclick: () => (menu ? closeGrid() : openGrid()),
        });
        tableButton.innerHTML = App.icons.get('table');
        tableButton.appendChild(el('span', { class: 'ribbon-button-label' }, ['Table ▾']));
        return tableButton;
    }

    /* The control named in the ribbon's layout, or null when it is not a table control. */
    App.tableControls.create = function create(name) {
        return name === 'insertTable' ? createInsertTable() : null;
    };

    // ---------------------------------------------------------------
    // Selected cells
    // ---------------------------------------------------------------

    let block = null;   // { element, slideId, anchor: { row, col }, focus: { row, col } } while a block of cells is selected
    let press = null;   // { element, cell } while the mouse button is down in a table
    let blockBox = null;   // the shaded rectangle on the overlay

    function slotOf(cell) {
        const cells = App.tables.blockOf(cell);
        return { row: cells.top, col: cells.left };
    }

    function tableOf(element) {
        return element.querySelector(':scope > table');
    }

    function currentBlock() {
        return block && block.element.isConnected
            ? App.tables.blockAround(tableOf(block.element), block.anchor, block.focus) : null;
    }

    /* Shade the selected cells: one rectangle around them, on the overlay (slide px, like the selection box). */
    function drawBlock() {
        const cells = currentBlock();
        if (!cells) {
            if (blockBox) {
                blockBox.hidden = true;
            }
            return;
        }
        if (!blockBox) {
            blockBox = el('div', { class: 'cell-block' });
            document.getElementById('overlay').appendChild(blockBox);
        }
        const rects = App.tables.cellBoxes(tableOf(block.element))
            .filter((box) => box.row >= cells.top && box.row <= cells.bottom && box.col >= cells.left && box.col <= cells.right)
            .map((box) => box.cell.getBoundingClientRect());   // the deck shows the slide at 1:1: slide px
        const left = Math.min(...rects.map((r) => r.left));
        const top = Math.min(...rects.map((r) => r.top));
        App.transform.writeRect(blockBox, { left: left, top: top,
            width: Math.max(...rects.map((r) => r.right)) - left, height: Math.max(...rects.map((r) => r.bottom)) - top });
        blockBox.hidden = false;
    }

    /* Select the cells from cell `from` to cell `to` of table element `element` (paste from Excel too). */
    App.tableControls.selectCells = function selectCellsFromOutside(element, from, to) {
        selectCells(element, from, to);
    };

    function selectCells(element, from, to) {
        block = { element: element, slideId: element.closest('section.slide').getAttribute('data-slide-id'),
            anchor: slotOf(from), focus: slotOf(to) };
        drawBlock();
        App.events.emit('table-cells-changed');
    }

    function clearBlock() {
        if (block) {
            block = null;
            drawBlock();
            App.events.emit('table-cells-changed');
        }
    }

    function startPress(element, cell) {
        clearBlock();
        press = { element: element, cell: cell };
    }

    /*
     * Undo / redo rebuilt the slide: the same cells stay selected in the table
     * found again by its id, if they are still inside it (else they are let go).
     */
    function keepBlockAfterChange() {
        if (!block || block.element.isConnected) {
            drawBlock();
            return;
        }
        const doc = App.deck.getDocument();
        const found = doc && doc.querySelector('[data-id="' + CSS.escape(block.element.getAttribute('data-id')) + '"]');
        const grid = found && tableOf(found) ? App.tables.gridOf(tableOf(found)) : null;
        const inside = (slot) => grid && slot.row < grid.rows && slot.col < grid.cols;
        if (inside(block.anchor) && inside(block.focus)) {
            block.element = found;
            drawBlock();
        } else {
            clearBlock();
        }
    }

    /*
     * A press in a table's cells while nothing is being typed (selection.js hands
     * it over): the overlay keeps the mouse until it is released. A drag into
     * another cell selects cells; a release in the same cell types in it, with
     * the cursor where the press was (as a click into a table in PowerPoint).
     */
    App.tableControls.pressCells = function pressCells(element, cell, downEvent, point) {
        const overlay = document.getElementById('overlay');
        startPress(element, cell);
        overlay.setPointerCapture(downEvent.pointerId);
        const onMove = (event) => followPress(App.selection.slidePoint(event), event.buttons);
        const finish = (event) => {
            overlay.removeEventListener('pointermove', onMove);
            overlay.removeEventListener('pointerup', finish);
            overlay.removeEventListener('pointercancel', finish);
            press = null;
            if (!block && event.type === 'pointerup') {
                App.text.enterEdit(cell, { point: point });
            }
        };
        overlay.addEventListener('pointermove', onMove);
        overlay.addEventListener('pointerup', finish);
        overlay.addEventListener('pointercancel', finish);
    };

    function followPress(point, buttons) {
        if (!press || !(buttons & 1)) {
            return;
        }
        const cell = App.tables.cellAt(press.element, point.x, point.y);
        if (!cell || (!block && cell === press.cell)) {
            return;
        }
        if (!block) {
            App.text.exitEdit({ select: false });   // from one cell into another: cells, not text
        }
        selectCells(press.element, press.cell, cell);
        App.deck.getDocument().getSelection().removeAllRanges();
    }

    function endPress() {
        press = null;
    }

    /* Presses inside the deck happen while a cell is being typed in (the overlay lets them through). */
    function onDeckPointerDown(event) {
        const cell = event.target.closest ? event.target.closest(App.tables.CELL_SELECTOR) : null;
        const typing = App.text.editingElement();
        if (!cell || event.button !== 0) {
            return;
        }
        const element = cell.closest('.el');
        if (event.shiftKey && typing && typing.tagName === 'TD' && typing.closest('.el') === element && typing !== cell) {
            // Shift+click: the cells from the one being typed in to this one.
            event.preventDefault();
            event.stopImmediatePropagation();
            App.text.exitEdit({ select: false });
            selectCells(element, typing, cell);
            return;
        }
        startPress(element, cell);
    }

    /* While cells are selected: Esc lets go of them (the table stays selected), Delete / Backspace empties them. */
    function onKeyDown(event) {
        if (!currentBlock()) {
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            clearBlock();
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            event.stopPropagation();
            clearCells();
        }
    }

    function selectedCellsOf(element, cells) {
        return App.tables.cellsIn(tableOf(element), cells);
    }

    /* Run `change` (an undo step on the table) with the selected cells staying selected, as in PowerPoint. */
    App.tableControls.keepCells = function keepCells(change) {
        const kept = block;
        change();
        if (kept && kept.element.isConnected) {
            block = kept;
            drawBlock();
            App.events.emit('table-cells-changed');
        }
    };

    function clearCells() {
        const element = block.element;
        const cells = selectedCellsOf(element, currentBlock());
        App.tableControls.keepCells(() => App.history.change('Clear cells', slideScope(element), () => {
            cells.forEach((cell) => App.text.clearText(cell));
            App.tables.alignNumbers(tableOf(element));
            App.tables.fitTable(element);
        }));
    }

    function slideScope(element) {
        return { slideId: element.closest('section.slide').getAttribute('data-slide-id') };
    }

    // ---------------------------------------------------------------
    // The Layout tab
    // ---------------------------------------------------------------

    /* Whether a table is the selected element (the Layout tab shows). */
    App.tableControls.isTableSelected = function isTableSelected() {
        const element = App.selection.getElement();
        return !!element && element.getAttribute('data-type') === 'table';
    };

    /* What the Layout buttons work on: the selected cells, or the cell being typed in (tabledesign.js too). */
    App.tableControls.cellTarget = function cellTarget() {
        const cells = currentBlock();
        if (cells) {
            return { element: block.element, table: tableOf(block.element), cells: cells, cell: null };
        }
        const typing = App.text.editingElement();
        if (typing && typing.tagName === 'TD') {
            const element = typing.closest('.el');
            return { element: element, table: tableOf(element), cells: App.tables.blockOf(typing), cell: typing };
        }
        return null;
    }

    const rowCount = (cells) => cells.bottom - cells.top + 1;
    const colCount = (cells) => cells.right - cells.left + 1;

    /* The cell covering slot (row, col), moved inside the table if the table is now smaller. */
    function cellAtSlot(table, row, col) {
        const grid = App.tables.gridOf(table);
        const cells = grid.cells[Math.min(row, grid.rows - 1)];
        return cells[Math.min(col, grid.cols - 1)];
    }

    function mergedIn(target) {
        return selectedCellsOf(target.element, target.cells).filter((cell) => cell.rowSpan > 1 || cell.colSpan > 1);
    }

    /*
     * The Layout actions: label, whether it can run on a target, and run(target),
     * which changes the table and returns the cell to type in afterwards (or null).
     */
    const LAYOUT = {
        insertRowAbove: { label: 'Insert rows above', run: (t) => { App.tables.insertRows(t.table, t.cells.top, rowCount(t.cells), t.cells.top); } },
        insertRowBelow: { label: 'Insert rows below',
            run: (t) => { App.tables.insertRows(t.table, t.cells.bottom + 1, rowCount(t.cells), t.cells.bottom); } },
        insertColumnLeft: { label: 'Insert columns left',
            run: (t) => { App.tables.insertColumns(t.table, t.cells.left, colCount(t.cells), t.cells.left); } },
        insertColumnRight: { label: 'Insert columns right',
            run: (t) => { App.tables.insertColumns(t.table, t.cells.right + 1, colCount(t.cells), t.cells.right); } },
        // After a delete, typing goes on in the cell that is now where the deleted ones were.
        deleteRows: { label: 'Delete rows', run: (t) => {
            if (rowCount(t.cells) === t.table.rows.length) {
                t.element.remove();   // every row: the table goes
                return null;
            }
            App.tables.deleteRows(t.table, t.cells.top, t.cells.bottom);
            return cellAtSlot(t.table, t.cells.top, t.cells.left);
        } },
        deleteColumns: { label: 'Delete columns', run: (t) => {
            if (colCount(t.cells) === App.tables.gridOf(t.table).cols) {
                t.element.remove();
                return null;
            }
            App.tables.deleteColumns(t.table, t.cells.left, t.cells.right);
            return cellAtSlot(t.table, t.cells.top, t.cells.left);
        } },
        mergeCells: { label: 'Merge cells', canRun: (t) => selectedCellsOf(t.element, t.cells).length > 1,
            run: (t) => App.tables.mergeCells(t.table, t.cells) },
        splitCells: { label: 'Split cells', canRun: (t) => mergedIn(t).length > 0, run: (t) => {
            const merged = mergedIn(t);
            merged.forEach((cell) => App.tables.splitCell(t.table, cell));
            return merged[0];
        } },
    };

    App.tableControls.layoutLabel = function layoutLabel(action) {
        return action === 'deleteTable' ? 'Delete table' : LAYOUT[action].label;
    };

    App.tableControls.canLayout = function canLayout(action) {
        // A locked table (Phase 7) keeps its size and stays: no rows or columns added or deleted, no Delete Table.
        if (App.elements.isLocked(App.selection.getElement()) && action !== 'mergeCells' && action !== 'splitCells') {
            return false;
        }
        if (action === 'deleteTable') {
            return App.tableControls.isTableSelected();
        }
        const target = App.tableControls.cellTarget();
        return !!target && (!LAYOUT[action].canRun || LAYOUT[action].canRun(target));
    };

    /* The columns decide the table's width (after inserting or deleting columns, or a paste). */
    App.tableControls.widthFromColumns = function widthFromColumns(element) {
        const widths = App.tables.colWidths(tableOf(element));
        const total = widths.reduce((a, b) => a + b, 0);
        if (total > 0) {
            element.style.setProperty('width', Math.round(total * 100) / 100 + 'px');
        }
    };

    /* Run a Layout action as one undo step; typing goes on in the same cell if it is still there. */
    App.tableControls.layout = function layout(action) {
        if (action === 'deleteTable') {
            App.text.exitEdit({ select: false });
            clearBlock();
            App.elements.remove('Delete table');
            return;
        }
        const target = App.tableControls.cellTarget();
        if (!App.tableControls.canLayout(action)) {
            return;
        }
        // The cell typed in before and after, so undo / redo go on typing in that cell even when it moved
        // (text.js afterHistoryChange; `redo` is filled in below, the step keeps this same object).
        const cells = { undo: target.cell ? App.text.containerKey(target.cell) : null, redo: null };
        App.text.exitEdit({ select: false });
        clearBlock();
        let next = null;
        App.history.change(LAYOUT[action].label, slideScope(target.element), () => {
            next = LAYOUT[action].run(target) || null;
            if (target.element.isConnected) {
                App.tableControls.widthFromColumns(target.element);
                App.tables.alignNumbers(target.table);   // a deleted row of words may leave a column of numbers
                App.tables.fitTable(target.element);
            }
        }, { meta: { cells: cells } });
        if (!target.element.isConnected) {
            App.selection.clear();
            return;
        }
        App.selection.select(target.element);
        const cell = next || (target.cell && target.cell.isConnected ? target.cell : null);
        if (cell) {
            cells.redo = App.text.containerKey(cell);
            App.text.enterEdit(cell, { caret: 'end' });
        }
    };

    // ---------------------------------------------------------------
    // Column borders
    // ---------------------------------------------------------------

    const BORDER_GRIP = 4;      // screen px either side of a column border
    const MIN_COLUMN = 24;      // slide px: room for the cell padding and a letter
    const DRAG_THRESHOLD = 3;   // screen px before a press becomes a drag

    let borderDrag = null;    // { element } while a column border is being dragged
    let hoverStyle = null;    // the deck's border-cursor rule while the mouse is over a border (typing)

    /* The inner column border of a table element under slide point `point`, or -1. */
    App.tableControls.borderAt = function borderAt(element, point) {
        return App.tables.columnBorderAt(element, point.x, point.y, BORDER_GRIP / App.canvas.getZoom());
    };

    App.tableControls.isDraggingBorder = function isDraggingBorder() {
        return borderDrag !== null;
    };

    /*
     * Follow a press on column border `border` until the mouse is released.
     * `target` keeps the mouse (the overlay, or the deck element pressed while
     * typing); toPoint(event) gives slide px. The columns follow live; the
     * whole drag is one undo step. A table pressed while typing elsewhere is
     * selected at the end.
     */
    App.tableControls.dragBorder = function dragBorder(element, border, downEvent, target, toPoint) {
        const table = tableOf(element);
        const startX = toPoint(downEvent).x;
        const startWidths = App.tables.colWidths(table);
        const zoom = App.canvas.getZoom();
        let started = false;
        borderDrag = { element: element };
        target.setPointerCapture(downEvent.pointerId);

        function onMove(event) {
            const dx = toPoint(event).x - startX;
            if (!started) {
                if (Math.abs(dx) * zoom < DRAG_THRESHOLD) {
                    return;
                }
                started = true;
                App.history.begin('Resize column', slideScope(element));
            }
            App.tables.setColumnWidths(table, App.tables.resizeColumn(startWidths, border, dx, MIN_COLUMN));
            App.tables.fitTable(element);   // the rows follow their wrapped text
            App.selection.refresh();
            drawBlock();
        }

        function finish() {
            target.removeEventListener('pointermove', onMove);
            target.removeEventListener('pointerup', finish);
            target.removeEventListener('pointercancel', finish);
            borderDrag = null;
            if (started) {
                App.history.commit();
            }
            const typing = App.text.editingElement();
            if (typing && !element.contains(typing)) {
                App.text.exitEdit({ select: false });
            }
            if (element.isConnected) {
                App.selection.select(element);
            }
        }

        target.addEventListener('pointermove', onMove);
        target.addEventListener('pointerup', finish);
        target.addEventListener('pointercancel', finish);
    };

    function deckTableAt(event) {
        const element = event.target.closest ? event.target.closest('.el[data-type="table"]') : null;
        return element && tableOf(element) ? element : null;
    }

    /*
     * While typing, the deck gets the mouse: over a column border, a rule in the
     * deck's head (editor-only, outside the slide's undo snapshots) shows the
     * border cursor over that table.
     */
    function onDeckHover(event) {
        if (borderDrag || event.buttons) {
            return;
        }
        const element = deckTableAt(event);
        const id = element && App.tableControls.borderAt(element, { x: event.clientX, y: event.clientY }) >= 0
            ? element.getAttribute('data-id') : null;
        const rule = id ? '[data-id="' + CSS.escape(id) + '"], [data-id="' + CSS.escape(id) + '"] * { cursor: col-resize !important; }' : '';
        if (rule && !(hoverStyle && hoverStyle.isConnected)) {
            hoverStyle = el('style', { 'data-editor-only': 'col-resize' });
            App.deck.getDocument().head.appendChild(hoverStyle);
        }
        if (hoverStyle && hoverStyle.textContent !== rule) {
            hoverStyle.textContent = rule;
        }
    }

    /* A press on a column border in the deck (while typing): drag it; the deck element pressed keeps the mouse. */
    function onDeckBorderDown(event) {
        const element = event.button === 0 ? deckTableAt(event) : null;
        const point = { x: event.clientX, y: event.clientY };
        const border = element ? App.tableControls.borderAt(element, point) : -1;
        if (border < 0) {
            return false;
        }
        event.preventDefault();   // the cursor stays where it is
        event.stopImmediatePropagation();
        clearBlock();
        App.tableControls.dragBorder(element, border, event, event.target, (e) => ({ x: e.clientX, y: e.clientY }));
        return true;
    }

    App.tableControls.init = function init() {
        App.events.on('deck-loaded', () => {
            block = null;
            press = null;
            borderDrag = null;
            hoverStyle = null;
            drawBlock();
            const doc = App.deck.getDocument();
            // Before text.js's own listener (added when typing starts): Shift+click must win over "edit that cell".
            doc.addEventListener('pointerdown', (event) => onDeckBorderDown(event) || onDeckPointerDown(event), true);
            doc.addEventListener('pointermove', (event) => {
                followPress({ x: event.clientX, y: event.clientY }, event.buttons);
                onDeckHover(event);
            });
            doc.addEventListener('pointerup', endPress);
        });
        window.addEventListener('keydown', onKeyDown, true);
        App.events.on('selection-changed', clearBlock);
        // deck.js also says "slide-changed" after an undo on the same slide: only a real slide change counts.
        App.events.on('slide-changed', () => {
            const slide = App.deck.getCurrentSlide();
            if (block && (!slide || slide.getAttribute('data-slide-id') !== block.slideId)) {
                clearBlock();
            }
        });
        App.events.on('history-changed', keepBlockAfterChange);
        App.events.on('text-edit-changed', (info) => {
            if (info.editing) {
                clearBlock();
            }
        });
        App.events.on('zoom-changed', drawBlock);
    };

    App.tableControls.refresh = function refresh() {
        if (tableButton && tableButton.isConnected) {
            tableButton.disabled = !App.commands.isEnabled('insertTable');
        }
    };
})();
