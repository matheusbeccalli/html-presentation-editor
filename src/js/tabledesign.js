/*
 * tabledesign.js - the look of tables (SPEC Phase 4): the Table Design tab and
 * the Layout tab's Alignment group, as in PowerPoint.
 *
 * Table Design (shown while a table is selected):
 *   - Table Style Options: Header Row, Total Row, Banded Rows, First Column
 *     (attributes on <table>, drawn by the deck's table stylesheet).
 *   - Shading: fills the cells; "No Fill"; "Table style" gives them back to
 *     the style's header / band fill.
 *   - Borders: the Borders list (All, Outside, Inside, Top, …, No Border) draws
 *     with the pen (weight and colour, chosen beside it).
 *   - Number (as Excel's): Thousands Separator, Increase / Decrease Decimal,
 *     Percent Style, Negatives in Parentheses. They rewrite the numbers in the
 *     cells (numbers.js), written as pt-BR (1.234,5) or en-US (1,234.5): the
 *     locale chosen beside them (remembered in the settings), else the deck's
 *     language.
 * Layout > Alignment: align the text to the top / middle / bottom of its cells;
 * Cell Margins (Normal, None, Narrow, Wide).
 *
 * They work on the selected cells, the cell being typed in, or, with the table
 * selected and nothing typed in, all its cells (the margins and the alignment
 * then go once onto the table). Each is one undo step; typing goes on.
 *
 * Talks to: tables.js (the cell look), numbers.js, settings.js (the number locale), tablecontrols.js (which cells),
 * textcontrols.js (colour split buttons, lists), commands.js, ribbon.js, history.js.
 */

(function () {
    'use strict';

    App.tableDesign = {};

    const el = (...args) => App.util.el(...args);

    const STYLE_OPTIONS = [
        ['tableHeaderRow', 'Header Row', 'data-header-row'],
        ['tableTotalRow', 'Total Row', 'data-total-row'],
        ['tableBandedRows', 'Banded Rows', 'data-banded-rows'],
        ['tableFirstColumn', 'First Column', 'data-first-column'],
    ];

    // PowerPoint's Borders list, in its order.
    const BORDERS = [
        ['bottom', 'Bottom Border'], ['top', 'Top Border'], ['left', 'Left Border'], ['right', 'Right Border'],
        ['none', 'No Border'], ['all', 'All Borders'], ['outside', 'Outside Borders'], ['inside', 'Inside Borders'],
        ['insideHorizontal', 'Inside Horizontal Border'], ['insideVertical', 'Inside Vertical Border'],
    ];

    const PEN_WEIGHTS = [0.5, 1, 1.5, 2, 3, 4.5, 6];   // px

    // PowerPoint's cell margin presets (its inches as px).
    const MARGINS = [['normal', 'Normal', '4px 8px'], ['none', 'None', '0px'], ['narrow', 'Narrow', '4px'], ['wide', 'Wide', '14px']];

    const ALIGNMENTS = [['cellAlignTop', 'Align Top', 'top'], ['cellAlignMiddle', 'Center Vertically', 'middle'],
        ['cellAlignBottom', 'Align Bottom', 'bottom']];

    let lastFill = null;      // the colour the Shading button applies (null: the theme's accent)
    let lastBorders = 'all';  // the kind the Borders button draws
    const pen = { weight: 1, color: null };   // null: the theme's text colour

    let styleBoxes = [];      // the Table Style Options checkboxes shown
    let localeButton = null;
    let penWeightButton = null;
    let marginsButton = null;
    let bordersMain = null;

    // ---------------------------------------------------------------
    // What the buttons work on
    // ---------------------------------------------------------------

    /* { element, table, block, cells, whole }: the selected cells, the cell being typed in, or all cells of the selected table. */
    function target() {
        const picked = App.tableControls.cellTarget();
        if (picked) {
            return { element: picked.element, table: picked.table, block: picked.cells,
                cells: App.tables.cellsIn(picked.table, picked.cells), whole: false };
        }
        if (!App.tableControls.isTableSelected()) {
            return null;
        }
        const element = App.selection.getElement();
        const table = element.querySelector(':scope > table');
        const block = App.tables.wholeBlock(table);
        return { element: element, table: table, block: block, cells: App.tables.cellsIn(table, block), whole: true };
    }

    function selectedTable() {
        const element = App.tableControls.isTableSelected() ? App.selection.getElement() : null;
        return element ? element.querySelector(':scope > table') : null;
    }

    /* One undo step on the target's table (`t`, by default the current one); the rows then follow their text; typing and the selected cells stay. */
    function change(label, run, t) {
        const on = t || target();
        if (!on) {
            return;
        }
        const scope = { slideId: on.element.closest('section.slide').getAttribute('data-slide-id') };
        App.tableControls.keepCells(() => App.history.change(label, scope, () => {
            run(on);
            App.tables.fitTable(on.element);
        }));
        App.selection.refresh();
    }

    function computed(cell) {
        return cell.ownerDocument.defaultView.getComputedStyle(cell);
    }

    function firstCell() {
        const t = target();
        return t ? t.cells[0] : null;
    }

    // ---------------------------------------------------------------
    // Actions
    // ---------------------------------------------------------------

    function themeHas(name) {
        const doc = App.deck.getDocument();
        return !!doc && App.text.themeColorNames(doc).indexOf(name) !== -1;
    }

    function currentFill() {
        return lastFill || (themeHas('--color-accent') ? 'var(--color-accent)' : '#ffc000');
    }

    function penColor() {
        return pen.color || (themeHas('--color-text') ? 'var(--color-text)' : '#000000');
    }

    /* The CSS border the pen draws. */
    App.tableDesign.penBorder = function penBorder() {
        return pen.weight + 'px solid ' + penColor();
    };

    function setFill(value) {
        change('Shading', (t) => App.tables.setFill(t.cells, value));
    }

    function setBorders(kind) {
        lastBorders = kind;
        change(BORDERS.find(([name]) => name === kind)[1], (t) =>
            App.tables.setBorders(t.table, t.block, kind, kind === 'none' ? 'none' : App.tableDesign.penBorder()));
    }

    function setBox(label, property, value) {
        change(label, (t) => App.tables.setCellBox(t.table, t.whole ? null : t.cells, property, value));
    }

    /* "4px 8px" -> its four sides, as computed styles give them. */
    function sides(padding) {
        const parts = padding.split(/\s+/);
        return [parts[0], parts[1] || parts[0], parts[2] || parts[0], parts[3] || parts[1] || parts[0]].join(' ');
    }

    function currentMargins() {
        const cell = firstCell();
        if (!cell) {
            return null;
        }
        const style = computed(cell);
        const shown = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].join(' ');
        const preset = MARGINS.find(([, , value]) => sides(value) === shown);
        return preset ? preset[0] : null;
    }

    // ---------------------------------------------------------------
    // Number formats
    // ---------------------------------------------------------------

    /* The locale numbers are read and written in: the one chosen, else the deck's language. */
    App.tableDesign.numberLocale = function numberLocale() {
        const doc = App.deck.getDocument();
        return App.settings.get().numberLocale || App.numbers.localeFor(doc ? doc.documentElement.getAttribute('lang') : '');
    };

    /* The numbers in the cells the buttons work on. */
    function targetNumbers() {
        const t = target();
        return t ? App.tables.numbersIn(t.cells, App.tableDesign.numberLocale()).map((found) => found.number) : [];
    }

    const isBig = (number) => number.int.replace(/^0+/, '').length >= 4;

    /*
     * The number buttons: change(on) gives what happens to each number (null: it
     * stays), on = the button was off. A toggle is on when all the numbers it
     * concerns have it.
     */
    const NUMBER_FORMATS = {
        numberThousands: {
            label: 'Thousands Separator',
            isChecked: (numbers) => numbers.some(isBig) && numbers.every((number) => !isBig(number) || number.grouped),
            change: (on) => (number) => Object.assign({}, number, { grouped: on }),
        },
        increaseDecimals: {
            label: 'Increase Decimal',
            change: () => (number) => App.numbers.withDecimals(number, number.frac.length + 1),
        },
        decreaseDecimals: {
            label: 'Decrease Decimal',
            change: () => (number) => (number.frac ? App.numbers.withDecimals(number, number.frac.length - 1) : null),
        },
        numberPercent: {
            // As in Excel, 0,195 becomes 19,5% (no digit is lost); a number with another unit (9,8x) stays.
            label: 'Percent Style',
            isChecked: (numbers) => numbers.length > 0 && numbers.every((number) => number.suffix === '%'),
            change: (on) => (number) => {
                if (on) {
                    return number.suffix ? null : App.numbers.toPercent(number);
                }
                return number.suffix === '%' ? App.numbers.fromPercent(number) : null;
            },
        },
        negativeParens: {
            label: 'Negatives in Parentheses',
            isChecked: (numbers) => numbers.some((number) => number.negative) &&
                numbers.every((number) => !number.negative || number.parens),
            change: (on) => (number) => (number.negative ? Object.assign({}, number, { parens: on }) : null),
        },
    };

    /*
     * Rewrite the numbers of the target's cells as one undo step. Typing in a
     * cell stops for it (its text is rewritten) and goes on after it.
     */
    function formatNumbers(label, rewrite) {
        const t = target();
        if (!t || targetNumbers().length === 0) {
            return;
        }
        const typing = App.text.editingElement();
        if (typing) {
            App.text.exitEdit({ select: false });
        }
        change(label, (on) => {
            App.tables.formatNumbers(on.cells, App.tableDesign.numberLocale(), rewrite);
            App.tables.alignNumbers(on.table);
        }, t);
        if (typing && typing.isConnected) {
            App.selection.select(t.element);
            App.text.enterEdit(typing, { caret: 'end' });
        }
    }

    /* The commands of this module (commands.js defines them). */
    App.tableDesign.commands = function commands() {
        const definitions = {};
        const canRun = () => target() !== null;
        STYLE_OPTIONS.forEach(([name, label, attribute]) => {
            definitions[name] = {
                label: label, keepsEdit: true, isEnabled: () => selectedTable() !== null,
                isChecked: () => !!selectedTable() && selectedTable().hasAttribute(attribute),
                run: () => {
                    const on = !selectedTable().hasAttribute(attribute);
                    change(label + (on ? ' on' : ' off'), (t) => t.table.toggleAttribute(attribute, on));
                },
            };
        });
        definitions.cellFill = { label: 'Shading', keepsEdit: true, isEnabled: canRun, run: () => setFill(currentFill()) };
        definitions.setCellFill = { label: 'Shading', keepsEdit: true, isEnabled: canRun, run: setFill };
        definitions.cellBorders = { label: 'Borders', keepsEdit: true, isEnabled: canRun, run: () => setBorders(lastBorders) };
        definitions.setCellBorders = { label: 'Borders', keepsEdit: true, isEnabled: canRun, run: setBorders };
        ALIGNMENTS.forEach(([name, label, value]) => {
            definitions[name] = {
                label: label, keepsEdit: true, isEnabled: canRun,
                isChecked: () => !!firstCell() && computed(firstCell()).verticalAlign === value,
                run: () => setBox(label, 'vertical-align', value),
            };
        });
        definitions.setCellMargins = {
            label: 'Cell Margins', keepsEdit: true, isEnabled: canRun,
            run: (name) => setBox('Cell margins', 'padding', MARGINS.find(([key]) => key === name)[2]),
        };
        const hasNumbers = () => targetNumbers().length > 0;
        Object.keys(NUMBER_FORMATS).forEach((name) => {
            const format = NUMBER_FORMATS[name];
            const isOn = () => !!format.isChecked && format.isChecked(targetNumbers());
            definitions[name] = {
                label: format.label, keepsEdit: true, isEnabled: hasNumbers, isChecked: format.isChecked ? isOn : undefined,
                run: () => formatNumbers(format.label, format.change(!isOn())),
            };
        });
        definitions.setNumberLocale = {
            label: 'Number format', keepsEdit: true,
            run: (locale) => {
                App.settings.update({ numberLocale: locale });
                App.ribbon.refresh();
            },
        };
        return definitions;
    };

    // ---------------------------------------------------------------
    // Ribbon controls
    // ---------------------------------------------------------------

    function keepEdit(node) {
        node.setAttribute('data-keep-edit', '');
        node.addEventListener('mousedown', (event) => event.preventDefault());   // the text keeps its cursor
        return node;
    }

    function createStyleOptions() {
        styleBoxes = STYLE_OPTIONS.map(([command, label]) => {
            const box = el('input', { type: 'checkbox', 'data-command': command, onchange: () => App.commands.run(command) });
            return { box: box, label: keepEdit(el('label', { class: 'table-style-option' }, [box, label])), command: command };
        });
        return el('div', { class: 'table-style-options' }, styleBoxes.map((item) => item.label));
    }

    /* A button with a text and a ▾ that opens a list (pen weight, cell margins). */
    function listButton(className, title, open) {
        return keepEdit(el('button', {
            type: 'button', class: 'ribbon-button small named list-button ' + className, title: title,
            'aria-label': title, 'aria-haspopup': 'menu',
            onclick: () => (App.textControls.isMenuOpen(className + '-menu') ? App.textControls.closeMenu() : open()),
        }));
    }

    function weightLabel(weight) {
        return weight + ' px';
    }

    function createPenWeight() {
        penWeightButton = listButton('pen-weight', 'Pen weight', () => App.textControls.openMenu(penWeightButton,
            'pen-weight-menu', PEN_WEIGHTS.map((weight) => ({ label: weightLabel(weight), value: weight, checked: weight === pen.weight })),
            (weight) => {
                pen.weight = weight;
                App.ribbon.refresh();
            }));
        return penWeightButton;
    }

    /* How numbers are written: "1.234,5 ▾" opens pt-BR / en-US. */
    function createLocale() {
        localeButton = listButton('number-locale', 'Numbers are written as …', () => {
            const current = App.tableDesign.numberLocale();
            App.textControls.openMenu(localeButton, 'number-locale-menu', Object.keys(App.numbers.LOCALES).map((locale) => ({
                label: App.numbers.LOCALES[locale].sample + '  (' + locale + ')', value: locale, checked: locale === current,
            })), (locale) => App.commands.run('setNumberLocale', locale));
        });
        return localeButton;
    }

    function createMargins() {
        marginsButton = listButton('cell-margins', 'Cell Margins', () => {
            const current = currentMargins();
            App.textControls.openMenu(marginsButton, 'cell-margins-menu', MARGINS.map(([name, label, value]) => ({
                label: label + ' (' + value.replace(/px/g, ' px').trim() + ')', value: name, checked: name === current,
            })), (name) => App.commands.run('setCellMargins', name));
        });
        marginsButton.innerHTML = App.icons.get('cellMargins');
        marginsButton.appendChild(el('span', { class: 'ribbon-button-label' }, ['Cell Margins ▾']));
        return marginsButton;
    }

    /* Borders: the main part draws the last kind chosen, the arrow lists them all. */
    function createBorders() {
        bordersMain = keepEdit(el('button', {
            type: 'button', class: 'ribbon-button small color-main borders-main', 'data-command': 'cellBorders',
            onclick: () => App.commands.run('cellBorders'),
        }));
        const arrow = keepEdit(el('button', {
            type: 'button', class: 'color-menu-button borders-menu-button', title: 'Borders: all kinds', 'aria-haspopup': 'menu',
            onclick: () => (App.textControls.isMenuOpen('borders-menu') ? App.textControls.closeMenu()
                : App.textControls.openMenu(bordersMain, 'borders-menu', BORDERS.map(([kind, label]) => ({ label: label, value: kind })),
                    (kind) => App.commands.run('setCellBorders', kind))),
        }, ['▾']));
        return el('div', { class: 'color-split' }, [bordersMain, arrow]);
    }

    /* The control named in the ribbon's layout, or null when it is not one of these. */
    App.tableDesign.create = function create(name) {
        if (name === 'tableStyleOptions') {
            return createStyleOptions();
        }
        if (name === 'cellFill') {
            return App.textControls.colorSplit({
                label: 'Shading', icon: 'shading', command: 'cellFill', menuClass: 'cell-fill-menu', palette: 'theme',
                extras: [['No Fill', 'transparent'], ['Table style fill', null]],
                current: currentFill,
                choose: (value) => {
                    if (value !== null && value !== 'transparent') {
                        lastFill = value;
                    }
                    App.commands.run('setCellFill', value);
                },
                isEnabled: () => App.commands.isEnabled('cellFill'),
            });
        }
        if (name === 'penColor') {
            return App.textControls.colorSplit({
                label: 'Pen color', icon: 'penColor', command: null, menuClass: 'pen-color-menu', palette: 'theme',
                current: penColor, choose: (value) => { pen.color = value; },
                isEnabled: () => App.commands.isEnabled('cellBorders'),
            });
        }
        if (name === 'cellBorders') {
            return createBorders();
        }
        if (name === 'penWeight') {
            return createPenWeight();
        }
        if (name === 'numberLocale') {
            return createLocale();
        }
        return name === 'cellMargins' ? createMargins() : null;
    };

    /* Checkboxes ticked as the table is; the Borders button names its kind; the pen weight shown. */
    App.tableDesign.refresh = function refresh() {
        styleBoxes.filter((item) => item.box.isConnected).forEach((item) => {
            item.box.disabled = !App.commands.isEnabled(item.command);
            item.box.checked = !!App.commands.isChecked(item.command);
        });
        if (bordersMain && bordersMain.isConnected) {
            const label = 'Borders: ' + BORDERS.find(([kind]) => kind === lastBorders)[1];
            bordersMain.title = label;
            bordersMain.setAttribute('aria-label', label);
            bordersMain.innerHTML = App.icons.get('borders-' + lastBorders);
            bordersMain.disabled = !App.commands.isEnabled('cellBorders');
            bordersMain.nextSibling.disabled = bordersMain.disabled;
        }
        if (penWeightButton && penWeightButton.isConnected) {
            penWeightButton.textContent = weightLabel(pen.weight) + ' ▾';
            penWeightButton.disabled = !App.commands.isEnabled('cellBorders');
        }
        if (localeButton && localeButton.isConnected) {
            const locale = App.tableDesign.numberLocale();
            localeButton.textContent = App.numbers.LOCALES[locale].sample + ' ▾';
            localeButton.title = 'Numbers are written as ' + App.numbers.LOCALES[locale].sample + ' (' + locale + ')';
        }
        if (marginsButton && marginsButton.isConnected) {
            marginsButton.disabled = !App.commands.isEnabled('setCellMargins');
        }
    };
})();
