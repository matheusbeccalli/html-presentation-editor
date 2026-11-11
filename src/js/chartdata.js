/*
 * chartdata.js - the chart's data grid (SPEC 5.3, Phase 6).
 *
 * A wide panel under the slide (where the speaker notes are; decided in the
 * Phase 6 Q&A) shows the selected chart's data as a grid: a row per category
 * (its name, "E" for an estimate, a waterfall's role), a column per series
 * (its name, colour, and in a combo its type and axis). Typing in a cell
 * redraws the chart at once; one cell's typing is one undo step (history
 * mergeKey). Rows and series are added, removed, and moved by dragging ⠿.
 *
 * It opens with a new chart (Insert > Chart), on a double-click on a chart and
 * from Chart Design > Edit Data; it closes with ×, Esc, or when something
 * other than a chart is selected.
 *
 * Numbers are typed as the deck writes them (pt-BR 1.234,5 or en-US 1,234.5,
 * numbers.js); a percentage series takes "18" as 18%.
 *
 * Paste from Excel (Phase 4's reader, tablepaste.readCells): in the grid,
 * several cells fill it from the cell (adding rows and series), or replace it
 * all when they are a whole table (series names across the top); on the
 * slide, Ctrl+V with a chart selected does the same for that chart.
 *
 * Talks to: charts.js (readData / writeData), numbers.js, tablepaste.js, history.js,
 *           selection.js, textcontrols.js (colour split buttons), tabledesign.js (locale).
 */

(function () {
    'use strict';

    App.chartData = {};

    const el = (...args) => App.util.el(...args);

    // ---------------------------------------------------------------
    // Numbers in the grid (pure)
    // ---------------------------------------------------------------

    /* A typed cell as a value: a number, null (empty) or undefined (not a number). */
    App.chartData.parseCell = function parseCell(text, locale, percent) {
        const typed = String(text).trim();
        if (typed === '') {
            return null;
        }
        const parts = App.numbers.parse(typed, locale);
        if (!parts) {
            return undefined;
        }
        let value = Number(parts.int + (parts.frac ? '.' + parts.frac : ''));
        if (parts.negative) {
            value = -value;
        }
        if (parts.suffix === '%' || percent) {
            value /= 100;
        }
        return Number(value.toPrecision(15));   // 19,5 / 100 is 0.195, not 0.19500000000000001
    };

    /* A value as the grid shows it: the locale's decimal sign, no thousands separators, % for percentages. */
    App.chartData.cellText = function cellText(value, locale, percent) {
        if (value === null || value === undefined) {
            return '';
        }
        const shown = percent ? Number((value * 100).toPrecision(12)) : value;
        const decimal = (App.numbers.LOCALES[locale] || App.numbers.LOCALES['pt-BR']).decimal;
        return String(shown).replace('.', decimal) + (percent ? '%' : '');
    };

    // ---------------------------------------------------------------
    // Rows and series (pure: they change the `data` given)
    // ---------------------------------------------------------------

    /* The estimates list, and a waterfall's roles, written out in full (so rows can be inserted into them). */
    function complete(data) {
        data.categories = Array.isArray(data.categories) ? data.categories : [];
        data.series = Array.isArray(data.series) ? data.series : [];
        const given = Array.isArray(data.estimates) ? data.estimates : [];
        data.estimates = data.categories.map((name, i) => !!given[i]);
        if (data.type === 'waterfall' || Array.isArray(data.roles)) {
            data.roles = App.charts.modelOf(data).roles;
        }
        data.series.forEach((series) => {
            series.values = data.categories.map((name, i) => (Array.isArray(series.values) && typeof series.values[i] === 'number'
                ? series.values[i] : null));
        });
        data.options = data.options || {};
    }

    /* Every list with one entry per category, as [list, entry for a new row]. */
    function rowLists(data) {
        const lists = [[data.categories, ''], [data.estimates, false]];
        if (Array.isArray(data.roles)) {
            lists.push([data.roles, 'delta']);
        }
        data.series.forEach((series) => {
            lists.push([series.values, null]);
            if (Array.isArray(series.colors)) {
                lists.push([series.colors, null]);
            }
        });
        return lists;
    }

    function move(list, from, to) {
        list.splice(to, 0, list.splice(from, 1)[0]);
    }

    /* Where index `i` ends up when the item at `from` moves to `to`. */
    function moved(i, from, to) {
        if (i === from) {
            return to;
        }
        if (from < to && i > from && i <= to) {
            return i - 1;
        }
        if (from > to && i >= to && i < from) {
            return i + 1;
        }
        return i;
    }

    /* A new, empty row at `index` (by default at the end; in a bridge, before its end). */
    App.chartData.addRow = function addRow(data, index) {
        complete(data);
        const count = data.categories.length;
        let at = index;
        if (at === undefined) {
            at = Array.isArray(data.roles) && data.roles[count - 1] === 'end' ? count - 1 : count;
        }
        rowLists(data).forEach(([list, entry]) => list.splice(at, 0, entry));
        const cagr = data.options.cagr;
        if (cagr) {
            cagr.from += cagr.from >= at ? 1 : 0;
            cagr.to += cagr.to >= at ? 1 : 0;
        }
        return at;
    };

    App.chartData.removeRow = function removeRow(data, index) {
        complete(data);
        rowLists(data).forEach(([list]) => list.splice(index, 1));
        const cagr = data.options.cagr;
        if (cagr) {
            if (cagr.from === index || cagr.to === index) {
                delete data.options.cagr;   // the growth it showed ran from or to that row
            } else {
                cagr.from -= cagr.from > index ? 1 : 0;
                cagr.to -= cagr.to > index ? 1 : 0;
            }
        }
    };

    App.chartData.moveRow = function moveRow(data, from, to) {
        complete(data);
        rowLists(data).forEach(([list]) => move(list, from, to));
        const cagr = data.options.cagr;
        if (cagr) {
            cagr.from = moved(cagr.from, from, to);
            cagr.to = moved(cagr.to, from, to);
        }
    };

    /* A new, empty series at the end, named "Série N". */
    App.chartData.addSeries = function addSeries(data) {
        complete(data);
        data.series.push({ name: 'Série ' + (data.series.length + 1), values: data.categories.map(() => null) });
        return data.series.length - 1;
    };

    App.chartData.removeSeries = function removeSeries(data, index) {
        complete(data);
        data.series.splice(index, 1);
        const cagr = data.options.cagr;
        if (cagr && cagr.series === index) {
            delete data.options.cagr;
        } else if (cagr && cagr.series > index) {
            cagr.series -= 1;
        }
    };

    App.chartData.moveSeries = function moveSeries(data, from, to) {
        complete(data);
        move(data.series, from, to);
        if (data.options.cagr) {
            data.options.cagr.series = moved(data.options.cagr.series, from, to);
        }
    };

    // ---------------------------------------------------------------
    // Paste from Excel (pure: rows are the pasted cells' texts)
    // ---------------------------------------------------------------

    function isNumber(text) {
        const typed = String(text === undefined || text === null ? '' : text).trim();
        return typed !== '' && App.numbers.parse(typed, 'pt-BR') !== null;
    }

    /*
     * A whole table: a header row of names (series) across the top, its first
     * cell empty or a name too. Then the first column (years too) is the
     * categories. A block that starts with numbers is not.
     */
    App.chartData.isWholeTable = function isWholeTable(rows) {
        return rows.length >= 2 && rows[0].length >= 2 && !isNumber(rows[0][0]) &&
            rows[0].slice(1).every((text) => String(text).trim() !== '' && !isNumber(text));
    };

    /*
     * A whole table as the chart's data: the first column the categories, each
     * other column a series named by its header (a column of text, not numbers,
     * is left out). A column of percentages is a % series; a category ending in
     * a digit and E (2026E) an estimate; a bridge's roles go back to first =
     * start, last = end. Series in the same place keep their colour and type.
     */
    App.chartData.fromRows = function fromRows(data, rows, locale) {
        const header = rows[0];
        const body = rows.slice(1).filter((row) => row.some((text) => String(text).trim() !== ''));
        const width = Math.max(...rows.map((row) => row.length));
        const old = Array.isArray(data.series) ? data.series : [];
        const series = [];
        for (let col = 1; col < width; col++) {
            const texts = body.map((row) => String(row[col] === undefined ? '' : row[col]).trim());
            const values = texts.map((text) => {
                const value = App.chartData.parseCell(text, locale, false);
                return value === undefined ? null : value;
            });
            const filled = texts.filter((text) => text !== '');
            if (filled.length > 0 && values.every((value) => value === null)) {
                continue;   // a column of names, not numbers
            }
            const kept = Object.assign({}, old[series.length]);
            delete kept.format;
            const item = Object.assign(kept, {
                name: String(header[col] === undefined ? '' : header[col]).trim() || 'Série ' + (series.length + 1), values: values,
            });
            if (filled.length > 0 && filled.every((text) => /%\)?$/.test(text))) {
                item.format = 'percent';
            }
            series.push(item);
        }
        data.categories = body.map((row) => String(row[0] === undefined ? '' : row[0]).trim());
        data.series = series;
        data.estimates = data.categories.map((name) => /\d\s*E$/i.test(name));
        delete data.roles;
        data.options = data.options || {};
        const cagr = data.options.cagr;
        if (cagr && (cagr.series >= series.length || cagr.to >= data.categories.length)) {
            delete data.options.cagr;
        }
    };

    /* A block pasted from row `row`, column `col` (-1: the category names): it fills over, adding rows and series. */
    App.chartData.fillRows = function fillRows(data, rows, row, col, locale) {
        complete(data);
        rows.forEach((cells, i) => cells.forEach((text, j) => {
            const r = row + i;
            const c = col + j;
            while (r >= data.categories.length) {
                App.chartData.addRow(data, data.categories.length);
            }
            if (c === -1) {
                data.categories[r] = String(text).trim();
                return;
            }
            while (c >= data.series.length) {
                App.chartData.addSeries(data);
            }
            const value = App.chartData.parseCell(text, locale, data.series[c].format === 'percent');
            data.series[c].values[r] = value === undefined ? null : value;
        }));
    };

    // ---------------------------------------------------------------
    // The panel
    // ---------------------------------------------------------------

    const ROLES = [['start', 'Start'], ['delta', 'Change'], ['subtotal', 'Subtotal'], ['end', 'End']];
    const NO_ESTIMATES = ['donut', 'pie', 'scatter', 'bubble', 'waterfall'];

    let panel = null;
    let grid = null;
    let shown = null;          // { id, slideId } of the chart in the grid
    let fromGrid = false;      // a change the grid itself made (no need to rebuild it)

    App.chartData.isOpen = function isOpen() {
        return shown !== null;
    };

    function figure() {
        const doc = App.deck.getDocument();
        return shown && doc ? doc.querySelector('[data-slide-id="' + CSS.escape(shown.slideId) + '"] [data-id="' +
            CSS.escape(shown.id) + '"]') : null;
    }

    function localeOf(data) {
        return (data.options && data.options.locale) || App.tableDesign.numberLocale();
    }

    /* Show `chart`'s data in the grid. */
    App.chartData.open = function open(chart) {
        if (!chart || !App.charts.readData(chart)) {
            return;
        }
        shown = { id: chart.getAttribute('data-id'), slideId: chart.closest('section.slide').getAttribute('data-slide-id') };
        panel.hidden = false;
        document.getElementById('notes-panel').hidden = true;
        render();
        App.events.emit('chart-data-changed');
    };

    App.chartData.close = function close() {
        if (!shown) {
            return;
        }
        shown = null;
        panel.hidden = true;
        document.getElementById('notes-panel').hidden = false;
        App.events.emit('chart-data-changed');
    };

    /*
     * Change the chart's data: `change` edits a copy, which is stored and drawn
     * as one undo step. options.mergeKey: typing in one cell is one step;
     * options.rebuild: rows or series changed, so the grid is built again.
     */
    function edit(label, change, options) {
        const chart = figure();
        if (!chart) {
            return;
        }
        const data = App.charts.readData(chart);
        complete(data);
        change(data);
        fromGrid = true;
        try {
            App.history.change(label, { slideId: shown.slideId }, () => App.charts.writeData(chart, data),
                { mergeKey: options && options.mergeKey });
        } finally {
            fromGrid = false;
        }
        if (options && options.rebuild) {
            render(options.focus);
        }
    }

    function focusInput(selector) {
        const input = selector && grid.querySelector(selector);
        if (input) {
            input.focus();
            if (input.select) {
                input.select();
            }
        }
    }

    /* Enter / arrows move down or up the same column; Esc closes the grid. */
    function onInputKey(event, kind, row, col) {
        const rows = grid.querySelectorAll('tbody tr').length;
        const step = event.key === 'ArrowDown' || (event.key === 'Enter' && !event.shiftKey) ? 1
            : event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey) ? -1 : 0;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            App.chartData.close();
            return;
        }
        if (step && kind !== 'series-name') {
            event.preventDefault();
            const next = Math.min(Math.max(row + step, 0), rows - 1);
            focusInput(kind === 'cell' ? 'input.cell[data-row="' + next + '"][data-col="' + col + '"]'
                : 'input.category[data-row="' + next + '"]');
        } else if (event.key === 'Enter') {
            event.preventDefault();
            event.target.blur();
        }
    }

    /*
     * Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) in a grid field: the editor's undo and redo, so all of a field's typing goes
     * back at once (the text box's own undo takes back one character at a time and leaves the chart out of step).
     */
    function onUndoKey(event) {
        const letter = event.key.toLowerCase();
        if ((event.ctrlKey || event.metaKey) && (letter === 'z' || letter === 'y')) {
            event.preventDefault();
            App.commands.run(letter === 'y' || event.shiftKey ? 'redo' : 'undo');
        }
    }

    function textInput(className, value, attrs, onInput) {
        const input = el('input', Object.assign({ type: 'text', class: className, value: value, autocomplete: 'off' }, attrs));
        input.addEventListener('focus', () => input.select());
        input.addEventListener('keydown', onUndoKey);
        input.addEventListener('input', () => {
            if (shown) {   // a closed grid's field changes no chart
                onInput(input);
            }
        });
        return input;
    }

    /* A ⠿ handle: dragging it moves its row (or series) to where it is dropped. */
    function dragHandle(className, index, attrs, places, onDrop) {
        const handle = el('span', Object.assign({ class: className, title: 'Drag to move' }, attrs), ['⠿']);
        handle.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            handle.setPointerCapture(event.pointerId);
            let to = index;
            const onMove = (moveEvent) => {
                const middles = places();
                const before = middles.filter((middle) => middle < (className === 'row-handle' ? moveEvent.clientY : moveEvent.clientX)).length;
                to = before > index ? before - 1 : before;
                grid.classList.toggle('dragging', true);
            };
            const onUp = () => {
                handle.removeEventListener('pointermove', onMove);
                handle.removeEventListener('pointerup', onUp);
                grid.classList.remove('dragging');
                if (to !== index) {
                    onDrop(to);
                }
            };
            handle.addEventListener('pointermove', onMove);
            handle.addEventListener('pointerup', onUp);
        });
        return handle;
    }

    function seriesHeader(data, series, col, locale) {
        const combo = data.type === 'combo';
        const parts = [
            dragHandle('series-handle', col, { 'data-col': String(col) },
                () => Array.from(grid.querySelectorAll('thead th.series-head'), (cell) => {
                    const box = cell.getBoundingClientRect();
                    return box.left + box.width / 2;
                }),
                (to) => edit('Move series', (copy) => App.chartData.moveSeries(copy, col, to), { rebuild: true })),
            textInput('series-name', series.name || '', { 'data-col': String(col), 'aria-label': 'Series name' }, (input) =>
                edit('Edit chart data', (copy) => { copy.series[col].name = input.value; }, { mergeKey: 'chart-series:' + shown.id + ':' + col })),
            App.textControls.colorSplit({
                label: 'Series colour', icon: 'shapeFill', command: null, menuClass: 'series-color-menu', palette: 'theme',
                extras: [['Automatic', null]],
                current: () => series.color || App.charts.defaultColor(col),
                choose: (value) => edit('Series colour', (copy) => {
                    if (value) {
                        copy.series[col].color = value;
                    } else {
                        delete copy.series[col].color;
                    }
                }, { rebuild: true }),
                isEnabled: () => true,
            }),
        ];
        if (combo) {
            const kind = series.type === 'line' || (!series.type && col > 0) ? 'line' : 'column';
            const type = el('select', { class: 'series-type', 'data-col': String(col), 'aria-label': 'Series type' },
                [['column', 'Column'], ['line', 'Line']].map(([value, label]) => el('option', { value: value }, [label])));
            type.value = kind;
            type.addEventListener('change', () => edit('Series type', (copy) => { copy.series[col].type = type.value; }, { rebuild: true }));
            const axis = el('select', { class: 'series-axis', 'data-col': String(col), 'aria-label': 'Axis' },
                [['primary', 'Main axis'], ['secondary', 'Right axis']].map(([value, label]) => el('option', { value: value }, [label])));
            axis.value = series.axis === 'secondary' ? 'secondary' : 'primary';
            axis.addEventListener('change', () => edit('Series axis', (copy) => { copy.series[col].axis = axis.value; }, { rebuild: true }));
            parts.push(type, axis);
        }
        parts.push(el('button', {
            type: 'button', class: 'series-remove', 'data-col': String(col), title: 'Remove this series', 'aria-label': 'Remove series',
            onclick: () => edit('Remove series', (copy) => App.chartData.removeSeries(copy, col), { rebuild: true }),
        }, ['×']));
        return el('th', { class: 'series-head' }, [el('div', { class: 'series-head-parts' }, parts)]);
    }

    function rowHeader(data, row) {
        const parts = [
            dragHandle('row-handle', row, { 'data-row': String(row) },
                () => Array.from(grid.querySelectorAll('tbody tr'), (line) => {
                    const box = line.getBoundingClientRect();
                    return box.top + box.height / 2;
                }),
                (to) => edit('Move row', (copy) => App.chartData.moveRow(copy, row, to), { rebuild: true })),
            textInput('category', data.categories[row], { 'data-row': String(row), 'aria-label': 'Category' }, (input) =>
                edit('Edit chart data', (copy) => { copy.categories[row] = input.value; }, { mergeKey: 'chart-category:' + shown.id + ':' + row })),
        ];
        const category = parts[1];
        category.addEventListener('keydown', (event) => onInputKey(event, 'category', row, -1));
        if (NO_ESTIMATES.indexOf(data.type) === -1) {
            const box = el('input', { type: 'checkbox', class: 'estimate', 'data-row': String(row), title: 'Estimate (lighter)' });
            box.checked = !!data.estimates[row];
            box.addEventListener('change', () => edit('Estimate', (copy) => { copy.estimates[row] = box.checked; }));
            parts.push(el('label', { class: 'estimate-label' }, [box, 'E']));
        }
        if (data.type === 'waterfall') {
            const role = el('select', { class: 'role', 'data-row': String(row), 'aria-label': 'Role' },
                ROLES.map(([value, label]) => el('option', { value: value }, [label])));
            role.value = data.roles[row];
            role.addEventListener('change', () => edit('Waterfall role', (copy) => { copy.roles[row] = role.value; }));
            parts.push(role);
        }
        parts.push(el('button', {
            type: 'button', class: 'row-remove', 'data-row': String(row), title: 'Remove this row', 'aria-label': 'Remove row',
            onclick: () => edit('Remove row', (copy) => App.chartData.removeRow(copy, row), { rebuild: true }),
        }, ['×']));
        return el('th', { class: 'row-head' }, [el('div', { class: 'row-head-parts' }, parts)]);
    }

    function valueCell(data, series, row, col, locale) {
        const percent = series.format === 'percent';
        const input = textInput('cell', App.chartData.cellText(series.values[row], locale, percent),
            { 'data-row': String(row), 'data-col': String(col), inputmode: 'decimal', 'aria-label': 'Value' }, () => {
                const value = App.chartData.parseCell(input.value, locale, percent);
                input.classList.toggle('invalid', value === undefined);
                if (value !== undefined) {
                    edit('Edit chart data', (copy) => { copy.series[col].values[row] = value; },
                        { mergeKey: 'chart-cell:' + shown.id + ':' + row + ':' + col });
                }
            });
        input.addEventListener('keydown', (event) => onInputKey(event, 'cell', row, col));
        return el('td', {}, [input]);
    }

    /* Build the grid again from the chart's data; the field that had the keyboard (or `focus`) gets it back. */
    function render(focus) {
        const chart = figure();
        const data = chart && App.charts.readData(chart);
        if (!data) {
            App.chartData.close();
            return;
        }
        complete(data);
        const active = document.activeElement && grid.contains(document.activeElement) ? document.activeElement : null;
        const keep = focus || (active ? 'input.' + active.classList[0] + Array.from(active.attributes)
            .filter((attribute) => /^data-(row|col)$/.test(attribute.name))
            .map((attribute) => '[' + attribute.name + '="' + attribute.value + '"]').join('') : null);
        const locale = localeOf(data);
        grid.replaceChildren(
            el('thead', {}, [el('tr', {}, [el('th', { class: 'corner' }, [data.type === 'scatter' || data.type === 'bubble'
                ? 'Point' : 'Category'])].concat(data.series.map((series, col) => seriesHeader(data, series, col, locale))))]),
            el('tbody', {}, data.categories.map((name, row) => el('tr', {}, [rowHeader(data, row)]
                .concat(data.series.map((series, col) => valueCell(data, series, row, col, locale)))))));
        if (keep) {
            focusInput(keep);
        }
    }

    /*
     * The clipboard's cells ({ html, text }, read as Phase 4 reads Excel) as
     * rows of texts; null for one value. In the grid a column of numbers, one
     * per line and no tabs, is cells too (in a text box it is just text).
     */
    function rowsOf(clipboard) {
        const cells = App.tablePaste.readCells(clipboard);
        if (cells) {
            return cells.cells.map((row) => row.map((cell) => (cell ? cell.lines.join(' ') : '')));
        }
        const lines = (clipboard.text || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
        return lines.length > 1 && !/<table/i.test(clipboard.html || '') ? lines.map((line) => line.split('\t')) : null;
    }

    /* Pasted rows into `data`: a whole table replaces it, a block fills from (row, col); numbers read as they show. */
    function pasteRows(data, rows, row, col) {
        const locale = App.numbers.localeShown([].concat(...rows)) || localeOf(data);
        if (App.chartData.isWholeTable(rows)) {
            App.chartData.fromRows(data, rows, locale);
        } else {
            App.chartData.fillRows(data, rows, row, col, locale);
        }
    }

    /* Ctrl+V in the grid: several cells fill it from the cell (or replace it all); one value pastes as typing. */
    function onGridPaste(event) {
        const target = event.target;
        if (!shown || !target.matches || !target.matches('input.cell, input.category')) {
            return;
        }
        const rows = rowsOf({ html: event.clipboardData.getData('text/html'), text: event.clipboardData.getData('text/plain') });
        if (!rows) {
            return;
        }
        event.preventDefault();
        const row = Number(target.getAttribute('data-row'));
        const col = target.classList.contains('category') ? -1 : Number(target.getAttribute('data-col'));
        edit('Paste chart data', (copy) => pasteRows(copy, rows, row, col), { rebuild: true });
    }

    /*
     * Ctrl+V on the slide with a chart selected (elements.js): cells from Excel
     * become its data (a whole table replaces it, numbers fill from the top
     * left) instead of a new table; the grid opens to show them. False when
     * there is no chart or no cells.
     */
    App.chartData.pasteOnChart = function pasteOnChart(clipboard) {
        const element = App.selection.getElement();
        if (!element || element.getAttribute('data-type') !== 'chart' || !App.charts.readData(element)) {
            return false;
        }
        const rows = rowsOf(clipboard);
        if (!rows) {
            return false;
        }
        App.chartData.open(element);
        edit('Paste chart data', (copy) => pasteRows(copy, rows, 0, 0), { rebuild: true });
        App.ui.setStatus('Pasted into the chart: ' + rows.length + ' rows (Ctrl+Z undoes it)');
        return true;
    };

    /* Wiring, called once from App.start(). */
    App.chartData.init = function init() {
        panel = document.getElementById('chart-data-panel');
        grid = document.getElementById('chart-data-grid');
        panel.addEventListener('paste', onGridPaste);
        document.getElementById('chart-data-close').addEventListener('click', () => App.chartData.close());
        document.getElementById('chart-data-add-row').addEventListener('click', () => {
            let row = 0;
            edit('Add row', (copy) => { row = App.chartData.addRow(copy); }, { rebuild: true });
            focusInput('input.category[data-row="' + row + '"]');
        });
        document.getElementById('chart-data-add-series').addEventListener('click', () => {
            let col = 0;
            edit('Add series', (copy) => { col = App.chartData.addSeries(copy); }, { rebuild: true });
            focusInput('input.series-name[data-col="' + col + '"]');
        });
        App.events.on('selection-changed', () => {
            if (!shown) {
                return;
            }
            const element = App.selection.getElement();
            if (element && element.getAttribute('data-type') === 'chart' && App.charts.readData(element)) {
                if (element.getAttribute('data-id') !== shown.id) {
                    App.chartData.open(element);
                }
            } else {
                App.chartData.close();
            }
        });
        App.events.on('history-changed', () => {
            if (shown && !fromGrid) {
                render();   // undo / redo, or a Chart Design change: show the data as it is now
            }
        });
        // 'slide-changed' also comes after an undo on the same slide: only another slide closes the grid.
        App.events.on('slide-changed', () => {
            const slide = App.deck.getCurrentSlide();
            if (shown && (!slide || slide.getAttribute('data-slide-id') !== shown.slideId)) {
                App.chartData.close();
            }
        });
        App.events.on('deck-loaded', () => App.chartData.close());
    };
})();
