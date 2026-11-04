/*
 * tablepaste.test.js - paste from Excel (Phase 4): the clipboard's table read as
 * cells, a new table built from it (the deck's look, or the source's), and the
 * cells filled into a table already on the slide. Real captures, fake text.
 */

function excelClipboard(name) {
    const types = clipboardFixture(name).types;
    return { html: types['text/html'], text: types['text/plain'] };
}

/* The text of each slot of a grid read by readCells (lines joined with "/"; '-' for a slot a merged cell covers). */
function gridTexts(grid) {
    return grid.cells.map((row) => row.map((cell) => (cell ? cell.lines.join('/') : '-')).join('|'));
}

test('tablepaste: reads Excel\'s table as the text it shows, with bold, and its column widths', () => {
    const grid = App.tablePaste.readCells(excelClipboard('excel-comps'));
    assertEqual(gridTexts(grid), ['Aaaaaa|AA (A$ aa)|AA/AAAAAA 2025A|Aaaaaa AAAAAA', 'Aaaa Aaaaa|2.450|9,8x|19,50%',
        'Aaaa Aaaaaaaa|1.120|8,9x|17,20%', 'Aaaaa Aaaaaa|780|10,4x|21,00%', 'Aaaaaaa Aaaaaaaaa|530|(1,2x)|-3,50%',
        'Aaaaaaa|950|9,4x|18,40%']);
    assertEqual(grid.cells.map((row) => row.map((cell) => (cell.bold ? 'b' : '.')).join('')), ['bbbb', '....', '....', '....', '....', 'bbbb']);
    assertEqual(grid.widths.map(Math.round), [192, 182, 130, 146]);
    assert(Math.abs(grid.fontSize - 14.67) < 0.1, 'Calibri 11 pt: ' + grid.fontSize);
});

test('tablepaste: a sheet without formatting, and tab-separated text when there is no HTML', () => {
    assertEqual(gridTexts(App.tablePaste.readCells(excelClipboard('excel-table'))), ['1,1|1,1|1,1', '2,2|2,2|2,2',
        '3,3|3,3|3,3', '4,4|4,4|4,4', '5,5|5,5|5,5']);
    const grid = App.tablePaste.readCells({ html: '', text: 'Empresa\tEV\r\nBeta\t"2.450\nmil"\r\nGama\r\n' });
    assertEqual(gridTexts(grid), ['Empresa|EV', 'Beta|2.450/mil', 'Gama|'], 'a quoted cell keeps its line break; a short row is filled');
    assertEqual(grid.widths, null);
});

test('tablepaste: one cell, text without tabs or HTML without a table is not a table', () => {
    assertEqual(App.tablePaste.readCells({ html: '<table><tr><td>2.450</td></tr></table>', text: '2.450\r\n' }), null);
    assertEqual(App.tablePaste.readCells({ html: '', text: 'two\nlines' }), null);
    assertEqual(App.tablePaste.readCells({ html: '<p>Hello <b>world</b></p>', text: 'Hello world' }), null);
});

test('tablepaste: merged cells, italic, and partly bold text', () => {
    const grid = App.tablePaste.readCells({ text: 'x\ty',
        html: '<table><tr><td colspan="2"><b>Title</b></td><td rowspan="2"><i>Note</i></td></tr>' +
            '<tr><td>A <b>b</b></td><td>1<br>2</td></tr></table>' });
    assertEqual(gridTexts(grid), ['Title|-|Note', 'A b|1/2|-']);
    const title = grid.cells[0][0];
    assertEqual([title.colSpan, title.rowSpan, title.bold, grid.cells[0][2].rowSpan, grid.cells[0][2].italic, grid.cells[1][0].bold],
        [2, 1, true, 2, true, false]);
});

test('tablepaste: nothing in the clipboard\'s HTML can run or load', () => {
    window.pastedScriptRan = false;
    const grid = App.tablePaste.readCells({ text: '',
        html: '<table><tr><td><img src="x" onerror="parent.pastedScriptRan = true">A</td><td>B<script>parent.pastedScriptRan = true</script></td></tr></table>' });
    assertEqual(gridTexts(grid), ['A|B']);
    assert(!window.pastedScriptRan, 'no script ran');
});

test('tablepaste: a new table in the deck\'s look keeps the text, bold and the columns\' proportions', () => {
    const { frame, element, table } = tableFrame((doc) => App.tablePaste.buildTable(doc, excelClipboard('excel-comps'), 'destination', 'e7'));
    try {
        App.tables.fitTable(element);
        assertEqual(element.getAttribute('data-id'), 'e7');
        assertEqual(App.tables.gridOf(table).cells.map((row) => row.map((cell) => cell.textContent).join('|'))[1], 'Aaaa Aaaaa|2.450|9,8x|19,50%');
        assert(table.hasAttribute('data-header-row') && table.hasAttribute('data-banded-rows'), 'the deck\'s table style');
        assert(table.hasAttribute('data-total-row'), 'a bold last row is a total row');
        assert(!table.querySelector('td[style]'), 'no fills, lines or fonts from Excel');
        assertEqual(table.rows[5].cells[1].querySelector('b').textContent, '950');
        assert(!table.rows[1].querySelector('b'), 'a plain row stays plain');
        assertEqual(Array.from(table.rows[1].cells).map((cell) => cell.hasAttribute('data-numeric')), [false, true, true, true]);
        const widths = App.tables.colWidths(table);
        const width = parseFloat(element.style.width);
        assert(Math.abs(widths.reduce((a, b) => a + b, 0) - width) < 0.05, 'the columns fill the box');
        assert(Math.abs(width - 650 * 18.67 / 14.67) < 2, 'as wide as in Excel at the deck\'s 14 pt: ' + width);
        assert(Math.abs(widths[0] / widths[2] - 192 / 130) < 0.01, 'the proportions of Excel\'s columns: ' + widths);
        assertEqual(parseFloat(element.style.left), Math.round((1280 - width) / 2 * 100) / 100, 'centred');
    } finally {
        frame.remove();
    }
});

test('tablepaste: Keep source formatting keeps Excel\'s fills, lines, fonts and widths', () => {
    const { frame, element, table } = tableFrame((doc) => App.tablePaste.buildTable(doc, excelClipboard('excel-comps'), 'source', 'e7'));
    try {
        App.tables.fitTable(element);
        const view = frame.contentWindow;
        const look = (r, c) => view.getComputedStyle(table.rows[r].cells[c]);
        assertEqual([look(0, 0).backgroundColor, look(0, 0).color, look(0, 0).fontWeight], ['rgb(14, 40, 65)', 'rgb(255, 255, 255)', '700']);
        assertEqual([look(5, 1).borderTopWidth, look(5, 1).fontWeight, look(1, 1).textAlign], ['1px', '700', 'right']);
        assertIncludes(look(1, 0).fontFamily, 'Calibri');
        assert(Math.abs(parseFloat(element.style.width) - 650) < 3, 'Excel\'s width: ' + element.style.width);
        assert(!table.hasAttribute('data-header-row'), 'its look is in the cells, not a table style');
    } finally {
        frame.remove();
    }
});

test('tablepaste: a merged cell stays merged in the new table', () => {
    const { frame, table } = tableFrame((doc) => App.tablePaste.buildTable(doc, { text: '',
        html: '<table><tr><td colspan="2">Title</td></tr><tr><td>A</td><td>1</td></tr></table>' }, 'destination', 'e7'));
    try {
        assertEqual([table.rows[0].cells.length, table.rows[0].cells[0].colSpan, table.rows[0].cells[0].textContent], [1, 2, 'Title']);
    } finally {
        frame.remove();
    }
});

test('tablepaste: fillCells writes from a slot on, adds the rows and columns it needs, and gives back the block', () => {
    const { frame, table } = tableFrame((doc) => App.tables.createTable(doc, 2, 2, { left: 0, top: 0, width: 400, height: 80 }, 'e1'));
    try {
        const grid = App.tablePaste.readCells({ html: '', text: 'a\tb\tc\n1\t2\t3\n4\t5\t6' });
        const block = App.tablePaste.fillCells(table, { row: 1, col: 1 }, grid);
        assertEqual(block, { top: 1, left: 1, bottom: 3, right: 3 });
        assertEqual(cellTexts(table), [',,,', ',a,b,c', ',1,2,3', ',4,5,6']);
        assertEqual(App.tables.colWidths(table).length, 4);
        App.tablePaste.fillCells(table, { row: 0, col: 0 }, App.tablePaste.readCells({ html: '', text: 'x\ty' }));
        assertEqual(cellTexts(table)[0], 'x,y,,', 'a cell with text is replaced');
    } finally {
        frame.remove();
    }
});
