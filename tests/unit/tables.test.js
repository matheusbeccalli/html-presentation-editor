/*
 * tables.test.js - the table model (Phase 4): the grid of merged cells, the deck's
 * table stylesheet, and tables converted on import (deck format 3).
 */

function tableFrom(rowsHtml) {
    return parseDoc('<table>' + rowsHtml + '</table>').querySelector('table');
}

function gridText(grid) {
    return grid.cells.map((row) => row.map((cell) => (cell ? cell.textContent : '-')).join('')).join('|');
}

test('tables: gridOf maps a merged cell onto every slot it covers', () => {
    const grid = App.tables.gridOf(tableFrom(
        '<tr><td colspan="2">A</td><td rowspan="2">B</td></tr><tr><td>C</td><td>D</td></tr>'));
    assertEqual(grid.rows, 2);
    assertEqual(grid.cols, 3);
    assertEqual(gridText(grid), 'AAB|CDB');
});

test('tables: gridOf marks the empty slots of a ragged table', () => {
    const grid = App.tables.gridOf(tableFrom('<tr><td>A</td><td>B</td></tr><tr><td>C</td></tr>'));
    assertEqual(grid.cols, 2);
    assertEqual(gridText(grid), 'AB|C-');
});

test('tables: gridOf keeps a rowspan inside the table', () => {
    const grid = App.tables.gridOf(tableFrom('<tr><td rowspan="5">A</td><td>B</td></tr><tr><td>C</td></tr>'));
    assertEqual(gridText(grid), 'AB|AC');
});

test('tables: the deck stylesheet draws the style options from the theme', () => {
    const css = App.tables.deckTableCss();
    assertIncludes(css, 'table-layout: fixed');
    assertIncludes(css, 'border-collapse: collapse');
    assertIncludes(css, 'table[data-header-row]');
    assertIncludes(css, 'table[data-banded-rows]');
    assertIncludes(css, 'table[data-total-row]');
    assertIncludes(css, 'table[data-first-column]');
    assertIncludes(css, 'var(--color-accent');
});

test('text: a table cell is normalized like a text box and always keeps a line to type in', () => {
    const doc = parseDoc('<table><tr><td>Receita <strong>480</strong></td><td></td></tr></table>');
    const cells = doc.querySelectorAll('td');
    cells.forEach((cell) => App.text.normalizeCell(cell));
    assertEqual(cells[0].innerHTML, '<p data-list="none" data-level="1">Receita <b>480</b></p>');
    assertEqual(cells[1].innerHTML, '<p data-list="none" data-level="1"><br></p>');
    App.text.normalizeCell(cells[0]);
    assertEqual(cells[0].innerHTML, '<p data-list="none" data-level="1">Receita <b>480</b></p>', 'idempotent');
});

test('text: numbering starts again in every table cell', () => {
    assertIncludes(App.text.deckTextCss(), '.el td { counter-reset: list-1 list-2 list-3 list-4 list-5; }');
});

// ---------- import (uses the measuring iframe) ----------

const COMPS_CSS =
    'table.comps{width:100%;border-collapse:collapse;font-size:19px}' +
    'table.comps th{background:var(--color-accent);color:#fff;text-align:left;padding:8px 10px}' +
    'table.comps td{padding:7px 10px;border-bottom:1px solid #ddd}' +
    'table.comps .num{text-align:right}' +
    'table.comps tr.total td{font-weight:700;border-top:2px solid #222}';

const COMPS_TABLE =
    '<table class="comps"><thead><tr><th>Empresa</th><th class="num">EV</th></tr></thead>' +
    '<tbody><tr><td>Beta</td><td class="num">2.450</td></tr>' +
    '<tr class="total"><td>Mediana</td><td class="num">950</td></tr></tbody></table>';

const TABLE_DECK_FORMAT_2 =
    '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="deck-format" content="2">' +
    '<style>:root{--color-accent:#1F2A44;--color-text:#222}' +
    '.slide{position:relative;width:1280px;height:720px;overflow:hidden}.el{position:absolute}' + COMPS_CSS + '</style>' +
    '</head><body><section class="slide" data-slide-id="s1">' +
    '<div class="el" data-type="text" data-id="e1" style="left:64px; top:48px; width:600px; height:60px; z-index:1">' +
    '<p data-list="none" data-level="1">Comparáveis</p></div>' +
    '<div class="el" data-type="table" data-id="e2" style="left:64px; top:140px; width:600px; height:200px; z-index:2">' +
    COMPS_TABLE + '</div><aside class="notes"></aside></section></body></html>';

function cellTexts(table) {
    return Array.from(table.rows).map((row) => Array.from(row.cells)
        .map((cell) => App.text.getModel(cell).map((line) => line.text).join('/')).join(','));
}

test('import: a format-2 deck\'s table is converted to the table model (format 3), keeping its look', async () => {
    const result = await App.importer.importDeck(TABLE_DECK_FORMAT_2);
    assert(result.report.isContract, 'still a contract deck');
    assertEqual(result.report.tablesConverted, 1);
    assertEqual(result.report.textConverted, 0, 'format-2 text is not converted again');
    assert(App.importer.reportHasChanges(result.report), 'the conversion marks the deck as changed');

    const doc = parseDoc(result.html);
    assertEqual(doc.querySelector('meta[name="deck-format"]').getAttribute('content'), '3');
    const element = doc.querySelector('[data-id="e2"]');
    assertEqual(element.getAttribute('style'), 'left:64px; top:140px; width:600px; height:200px; z-index:2', 'box unchanged');
    assertEqual(element.children.length, 1);
    const table = element.firstElementChild;
    assertEqual(table.tagName, 'TABLE');
    assert(!table.hasAttribute('class') && !doc.querySelector('.el [class]'), 'the deck\'s classes are gone (look is inline)');
    assertEqual(table.querySelectorAll('thead, tfoot, th').length, 0, 'one tbody of td only');
    assertEqual(table.tBodies.length, 1);
    assertEqual(JSON.stringify(cellTexts(table)), JSON.stringify(['Empresa,EV', 'Beta,2.450', 'Mediana,950']));
    table.querySelectorAll('td').forEach((cell) => {
        assert(Array.from(cell.children).every((child) => child.matches('p[data-list][data-level]')), 'cell text in the text model');
    });

    const widths = Array.from(table.querySelectorAll('colgroup > col')).map((col) => parseFloat(col.style.width));
    assertEqual(widths.length, 2);
    assert(Math.abs(widths[0] + widths[1] - 600) < 1, 'column widths add up to the table width: ' + widths);
    Array.from(table.rows).forEach((row) => assert(parseFloat(row.style.height) > 20, 'row height kept: ' + row.style.height));

    // What most cells share is said once, on the table; a cell keeps only what differs.
    assertEqual(table.style.getPropertyValue('--cell-padding'), '7px 10px');
    assertEqual(table.style.getPropertyValue('--cell-border-bottom'), '1px solid rgb(221, 221, 221)');
    assertEqual(table.style.getPropertyValue('--cell-vertical-align'), 'middle', 'the browser default for cells');
    assertEqual(table.style.getPropertyValue('--cell-border-top'), '', 'equal to the stylesheet default: not written');
    assertEqual(table.style.fontSize, '14.5pt', '19px, to the half point like text boxes');
    const [header, body, total] = Array.from(table.rows).map((row) => row.cells);
    assertEqual(header[0].style.backgroundColor, 'var(--color-accent)', 'theme fill stays linked to the theme');
    assertEqual(header[0].style.color, 'rgb(255, 255, 255)');
    assertEqual(header[0].style.fontWeight || table.style.fontWeight, 'bold', '<th> bold kept');
    assertEqual(header[0].style.padding, '8px 10px');
    assertEqual(header[0].style.borderBottom, 'none', 'no line under the header');
    assertEqual(body[1].style.textAlign || table.style.textAlign, 'right', 'numbers stay right-aligned');
    assertEqual(body[0].style.textAlign || table.style.textAlign, 'left');
    assertEqual(total[0].style.borderTop, '2px solid rgb(34, 34, 34)');
    assertEqual(total[0].style.fontWeight || table.style.fontWeight, 'bold');
    assertEqual(body[0].style.fontWeight || table.style.fontWeight, 'normal');
});

test('import: a converted table looks as it did', async () => {
    // Both versions laid out in the test page: every cell's text at the same place and size.
    const before = parseDoc(TABLE_DECK_FORMAT_2);
    const after = parseDoc((await App.importer.importDeck(TABLE_DECK_FORMAT_2)).html);
    const frames = [before, after].map((doc) => {
        const frame = document.createElement('iframe');
        frame.style.cssText = 'position:absolute; left:-3000px; width:1280px; height:720px';
        document.body.appendChild(frame);
        frame.contentDocument.open();
        frame.contentDocument.write('<!DOCTYPE html>' + doc.documentElement.outerHTML);
        frame.contentDocument.close();
        return frame;
    });
    try {
        const cells = frames.map((frame) => Array.from(frame.contentDocument.querySelectorAll('td, th')).map((cell) => {
            const walker = frame.contentDocument.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
            const range = frame.contentDocument.createRange();
            range.selectNodeContents(walker.nextNode());
            const look = frame.contentWindow.getComputedStyle(range.startContainer.parentElement);
            return { box: cell.getBoundingClientRect(), text: range.getBoundingClientRect(), size: parseFloat(look.fontSize),
                rest: [look.fontWeight, look.color, frame.contentWindow.getComputedStyle(cell).backgroundColor].join(' ') };
        }));
        assertEqual(cells[1].length, cells[0].length);
        cells[0].forEach((old, index) => {
            const now = cells[1][index];
            const where = 'cell ' + index + ': ';
            ['left', 'top', 'width', 'height'].forEach((side) => {
                assert(Math.abs(now.box[side] - old.box[side]) < 1, where + 'box ' + side + ' ' + now.box[side] + ' vs ' + old.box[side]);
            });
            // Text: same place, give or take the half point the size is rounded to (19px -> 14.5pt).
            assert(Math.abs(now.text.right - old.text.right) < 2 && Math.abs(now.text.left - old.text.left) < 2,
                where + 'text from ' + now.text.left + ' to ' + now.text.right + ' vs ' + old.text.left + ' to ' + old.text.right);
            assert(Math.abs(now.text.top - old.text.top) < 1, where + 'text top');
            assert(Math.abs(now.size - old.size) <= 0.5, where + 'size ' + now.size + ' vs ' + old.size);
            assertEqual(now.rest, old.rest, where + 'weight, colour, fill');
        });
    } finally {
        frames.forEach((frame) => frame.remove());
    }
});

test('import: a format-3 deck\'s table is left as it is', async () => {
    const converted = (await App.importer.importDeck(TABLE_DECK_FORMAT_2)).html;
    const result = await App.importer.importDeck(converted);
    assertEqual(result.report.tablesConverted, 0);
    assert(!App.importer.reportHasChanges(result.report), 'nothing to report');
    const before = parseDoc(converted).querySelector('[data-id="e2"]').innerHTML;
    assertEqual(parseDoc(result.html).querySelector('[data-id="e2"]').innerHTML, before);
});

test('import: a flow-layout deck\'s table becomes a model table', async () => {
    const html = '<html><head><style>section{width:1280px;height:720px}' + COMPS_CSS + '</style></head><body><section>' +
        '<h1>Comparáveis</h1>' + COMPS_TABLE + '</section></body></html>';
    const result = await App.importer.importDeck(html);
    assertEqual(result.report.tablesConverted, 1);
    const doc = parseDoc(result.html);
    const table = doc.querySelector('.el[data-type="table"] > table');
    assert(table, 'the .el holds the table');
    assertEqual(JSON.stringify(cellTexts(table)), JSON.stringify(['Empresa,EV', 'Beta,2.450', 'Mediana,950']));
    assertEqual(table.querySelectorAll('th, thead, [class]').length, 0);
    const element = table.parentElement;
    assert(parseFloat(element.style.width) > 1200, 'the table keeps its rendered width (100% of the slide): ' + element.style.width);
});

test('import: a table caption is dropped and reported', async () => {
    const html = TABLE_DECK_FORMAT_2.replace('<table class="comps">', '<table class="comps"><caption>Fonte: empresa</caption>');
    const result = await App.importer.importDeck(html);
    assert(result.report.warnings.some((warning) => warning.indexOf('Fonte: empresa') !== -1),
        'warning names the caption: ' + JSON.stringify(result.report.warnings));
});

test('import: every deck gets the current table stylesheet, before the text stylesheet', async () => {
    const stale = TABLE_DECK_FORMAT_2.replace('</head>', '<style data-deck-table>/* old */</style></head>');
    const doc = parseDoc((await App.importer.importDeck(stale)).html);
    const styles = Array.from(doc.head.querySelectorAll('style'));
    const tables = doc.head.querySelectorAll('style[data-deck-table]');
    assertEqual(tables.length, 1);
    assertEqual(tables[0].textContent, App.tables.deckTableCss());
    assert(styles.indexOf(tables[0]) < styles.indexOf(doc.head.querySelector('style[data-deck-text]')),
        'the text stylesheet stays last');
    assert(styles.indexOf(tables[0]) > styles.findIndex((s) => s.textContent.indexOf('table.comps') !== -1),
        'after the deck\'s own CSS, so its generic td rules cannot restyle model tables');
});

test('serialize: table cells are saved in the text model', () => {
    const doc = parseDoc('<html><head></head><body><section class="slide"><div class="el" data-type="table" data-id="e1">' +
        '<table><tbody><tr><td><div>Beta</div></td></tr></tbody></table></div></section></body></html>');
    const copy = App.serialize.cleanCopy(doc);
    assertEqual(copy.querySelector('td').innerHTML, '<p data-list="none" data-level="1">Beta</p>');
});

// ---------- new tables (Insert > Table) and fitting a table to its box ----------

test('tables: a new table is centred on the slide, 960 px wide, 40 px per row', () => {
    assertEqual(JSON.stringify(App.tables.newTableRect(3, 4)), JSON.stringify({ left: 160, top: 300, width: 960, height: 120 }));
    assertEqual(JSON.stringify(App.tables.newTableRect(10, 10)), JSON.stringify({ left: 160, top: 160, width: 960, height: 400 }));
});

test('tables: createTable builds an empty model table with a header row and banded rows', () => {
    const doc = parseDoc('<html><body></body></html>');
    const element = App.tables.createTable(doc, 3, 4, { left: 160, top: 300, width: 960, height: 120 }, 'e7');
    assertEqual(element.getAttribute('class'), 'el');
    assertEqual(element.getAttribute('data-type'), 'table');
    assertEqual(element.getAttribute('data-id'), 'e7');
    assertEqual(element.getAttribute('style'), 'left: 160px; top: 300px; width: 960px; height: 120px;');
    const table = element.firstElementChild;
    assert(table.hasAttribute('data-header-row') && table.hasAttribute('data-banded-rows'), 'PowerPoint\'s default options');
    assert(!table.hasAttribute('data-total-row') && !table.hasAttribute('data-first-column'), 'the others are off');
    assertEqual(Array.from(table.querySelectorAll('col')).map((col) => col.style.width).join(), '240px,240px,240px,240px');
    assertEqual(Array.from(table.rows).map((row) => row.style.height).join(), '40px,40px,40px');
    assertEqual(table.querySelectorAll('td').length, 12);
    table.querySelectorAll('td').forEach((cell) => {
        assertEqual(JSON.stringify(App.text.getModel(cell)), JSON.stringify([{ list: 'none', level: 1, start: null, text: '' }]));
    });
});

test('tables: createTable splits an odd width so the columns add up exactly', () => {
    const doc = parseDoc('<html><body></body></html>');
    const element = App.tables.createTable(doc, 1, 3, { left: 0, top: 0, width: 100, height: 40 }, 'e1');
    const widths = Array.from(element.querySelectorAll('col')).map((col) => parseFloat(col.style.width));
    assertEqual(widths.join(), '33.33,33.33,33.34');
});

/* A slide in an off-screen frame with the deck's table and text stylesheets, for measuring. */
function tableFrame(build) {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:absolute; left:-3000px; top:0; width:1280px; height:720px';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write('<!DOCTYPE html><html><head><style>.slide{position:relative;width:1280px;height:720px}.el{position:absolute}' +
        App.tables.deckTableCss() + App.text.deckTextCss() + '</style></head><body><section class="slide"></section></body></html>');
    doc.close();
    const element = build(doc);
    doc.querySelector('.slide').appendChild(element);
    return { frame: frame, element: element, table: element.firstElementChild };
}

test('tables: fitTable scales the columns to a new width and the rows to a new height', () => {
    const { frame, element, table } = tableFrame((doc) =>
        App.tables.createTable(doc, 3, 4, { left: 160, top: 300, width: 960, height: 120 }, 'e1'));
    try {
        assert(!App.tables.fitTable(element), 'a new table already fits its box');
        element.style.width = '480px';
        element.style.height = '300px';
        assert(App.tables.fitTable(element, { resized: true }), 'changed');
        assertEqual(Array.from(table.querySelectorAll('col')).map((col) => col.style.width).join(), '120px,120px,120px,120px');
        assertEqual(Array.from(table.rows).map((row) => row.style.height).join(), '100px,100px,100px');
        assertEqual(element.style.height, '300px');
        assertEqual(table.getBoundingClientRect().width, 480);
        assertEqual(Array.from(table.rows).reduce((sum, row) => sum + row.getBoundingClientRect().height, 0), 300);
    } finally {
        frame.remove();
    }
});

function drawnHeights(table) {
    return Array.from(table.rows).map((row) => Math.round(row.getBoundingClientRect().height * 100) / 100);
}

test('tables: fitTable never makes a row shorter than its text; the box takes the rows\' real height', () => {
    const { frame, element, table } = tableFrame((doc) =>
        App.tables.createTable(doc, 3, 2, { left: 0, top: 0, width: 400, height: 120 }, 'e1'));
    try {
        element.style.height = '15px';
        App.tables.fitTable(element, { resized: true });
        drawnHeights(table).forEach((height) => assert(height > 20, 'a row keeps room for a line of 14pt text: ' + height));
        const drawn = Array.from(table.rows).reduce((sum, row) => sum + row.getBoundingClientRect().height, 0);
        assertEqual(parseFloat(element.style.height), Math.round(drawn * 100) / 100, 'the box is as tall as its rows');
    } finally {
        frame.remove();
    }
});

test('tables: a row grows with its text and goes back to its own height when the text is gone', () => {
    const { frame, element, table } = tableFrame((doc) =>
        App.tables.createTable(doc, 2, 2, { left: 0, top: 0, width: 400, height: 80 }, 'e1'));
    try {
        const cell = table.rows[0].cells[0];
        const before = cell.innerHTML;
        cell.innerHTML = '<p data-list="none" data-level="1">Um</p><p data-list="none" data-level="1">Dois</p>' +
            '<p data-list="none" data-level="1">Três</p>';
        assert(App.tables.fitTable(element), 'changed');
        assert(parseFloat(element.style.height) > 100, 'the box grew: ' + element.style.height);
        assertEqual(table.rows[0].style.height, '40px', 'the row keeps its own height (a minimum)');
        cell.innerHTML = before;
        App.tables.fitTable(element);
        assertEqual(element.style.height, '80px', 'back to two 40 px rows');
    } finally {
        frame.remove();
    }
});

test('tables: appendRow adds a row like the last one: same height, fills and borders, empty cells', () => {
    const table = tableFrom('<tbody><tr style="height: 30px"><td style="background-color: red">A</td><td>B</td></tr>' +
        '<tr style="height: 50px"><td colspan="2" style="border-top: 2px solid black">Total</td></tr></tbody>');
    const row = App.tables.appendRow(table);
    assertEqual(table.rows.length, 3);
    assertEqual(row, table.rows[2]);
    assertEqual(row.style.height, '50px');
    assertEqual(row.cells.length, 1);
    assertEqual(row.cells[0].getAttribute('colspan'), '2');
    assertEqual(row.cells[0].style.borderTop, '2px solid black');
    assertEqual(row.cells[0].innerHTML, '<p data-list="none" data-level="1"><br></p>');
});

test('tables: appendRow under a cell merged down gives that column a cell of its own', () => {
    const table = tableFrom('<tbody><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></tbody>');
    const row = App.tables.appendRow(table);
    assertEqual(row.cells.length, 2);
    assert(!row.cells[0].hasAttribute('rowspan'), 'the new cell is not merged');
});

test('text: a cell is found again from its key after the slide was rebuilt (undo)', () => {
    const doc = parseDoc('<html><body><section class="slide" data-slide-id="s1"><div class="el" data-type="table" data-id="e9">' +
        '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td colspan="2">C</td></tr></tbody></table></div>' +
        '<div class="el" data-type="text" data-id="e2"><p data-list="none" data-level="1">T</p></div></section></body></html>');
    const cell = doc.querySelectorAll('td')[1];
    assertEqual(App.text.containerKey(cell), 'e9/0/1');
    assertEqual(App.text.containerKey(doc.querySelector('[data-id="e2"]')), 'e2');
    const copy = parseDoc(doc.documentElement.outerHTML);
    assertEqual(App.text.findContainer(copy, 's1', 'e9/0/1').textContent, 'B');
    assertEqual(App.text.findContainer(copy, 's1', 'e9/1/0').textContent, 'C');
    assertEqual(App.text.findContainer(copy, 's1', 'e2').getAttribute('data-id'), 'e2');
    assertEqual(App.text.findContainer(copy, 's1', 'e9/5/0'), null);
});

test('text: containersIn lists text boxes and table cells in reading order', () => {
    const doc = parseDoc('<html><body><section class="slide"><div class="el" data-type="text" data-id="e1">1</div>' +
        '<div class="el" data-type="table" data-id="e2"><table><tbody><tr><td>2</td><td>3</td></tr></tbody></table></div>' +
        '<div class="el" data-type="text" data-id="e3">4</div></section></body></html>');
    assertEqual(App.text.containersIn(doc.querySelector('section')).map((node) => node.textContent).join(), '1,2,3,4');
});

test('table controls: the grid picker moves with the arrow keys inside 10 x 10', () => {
    const move = (pick, key) => JSON.stringify(App.tableControls.movePick(pick, key));
    assertEqual(move({ rows: 1, cols: 1 }, 'ArrowRight'), JSON.stringify({ rows: 1, cols: 2 }));
    assertEqual(move({ rows: 1, cols: 1 }, 'ArrowLeft'), JSON.stringify({ rows: 1, cols: 1 }));
    assertEqual(move({ rows: 10, cols: 4 }, 'ArrowDown'), JSON.stringify({ rows: 10, cols: 4 }));
    assertEqual(move({ rows: 3, cols: 4 }, 'ArrowUp'), JSON.stringify({ rows: 2, cols: 4 }));
    assertEqual(App.tableControls.pickLabel({ rows: 3, cols: 4 }), '4 × 3 table', 'columns first, as PowerPoint');
});
