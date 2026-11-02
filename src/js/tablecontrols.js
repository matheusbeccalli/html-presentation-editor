/*
 * tablecontrols.js - the ribbon's table controls (SPEC Phase 4).
 *
 * Insert > Table opens a 10 x 10 grid, as in PowerPoint: moving the mouse over
 * it picks a size ("4 × 3 table": columns first), a click inserts it. The arrow
 * keys move the pick and Enter inserts it; Esc or a click elsewhere closes it.
 *
 * Talks to: commands.js (insertTable), ribbon.js (places the control).
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

    App.tableControls.refresh = function refresh() {
        if (tableButton && tableButton.isConnected) {
            tableButton.disabled = !App.commands.isEnabled('insertTable');
        }
    };
})();
