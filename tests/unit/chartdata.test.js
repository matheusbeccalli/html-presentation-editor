/*
 * chartdata.test.js - the chart data grid (Phase 6 step 7): numbers typed as
 * the deck writes them, and rows / series added, removed and moved with all
 * the lists that go with them (categories, estimates, roles, each series' values).
 * Fake numbers only.
 */

function sampleBridge() {
    return {
        version: 1, type: 'waterfall', categories: ['Início', 'Aumento', 'Fim'], estimates: [false, false, true],
        roles: ['start', 'delta', 'end'], series: [{ name: 'Valor', values: [100, 30, 130] }], options: {},
    };
}

function sampleColumns() {
    return {
        version: 1, type: 'column', categories: ['2022', '2023', '2024'], estimates: [false, false, true],
        series: [{ name: 'Receita', values: [100, 120, 135] }, { name: 'EBITDA', values: [30, 36, 42] }], options: {},
    };
}

test('chart data: a typed number is read the deck\'s way; percentage series take "18" as 18%', () => {
    const read = App.chartData.parseCell;
    assertEqual(read('1.234,5', 'pt-BR', false), 1234.5);
    assertEqual(read('1,234.5', 'en-US', false), 1234.5);
    assertEqual(read('-25', 'pt-BR', false), -25);
    assertEqual(read('(25)', 'pt-BR', false), -25, 'parentheses: negative');
    assertEqual(read('18%', 'pt-BR', false), 0.18);
    assertEqual(read('18', 'pt-BR', true), 0.18);
    assertEqual(read('19,5%', 'pt-BR', true), 0.195);
    assertEqual(read('', 'pt-BR', false), null, 'empty: no value');
    assertEqual(read('abc', 'pt-BR', false), undefined, 'not a number');
});

test('chart data: a value as the grid shows it (no thousands separators, nothing rounded away)', () => {
    const show = App.chartData.cellText;
    assertEqual(show(1234.5, 'pt-BR', false), '1234,5');
    assertEqual(show(1234.5, 'en-US', false), '1234.5');
    assertEqual(show(0.195, 'pt-BR', true), '19,5%');
    assertEqual(show(0.07, 'pt-BR', true), '7%', 'no floating-point noise');
    assertEqual(show(null, 'pt-BR', false), '');
});

test('chart data: adding a row keeps every list in line; a bridge gets its new row before the end', () => {
    const data = sampleColumns();
    App.chartData.addRow(data);
    assertEqual(data.categories.length, 4);
    assertEqual([data.estimates[3], data.series[0].values[3], data.series[1].values[3]], [false, null, null]);
    const bridge = sampleBridge();
    App.chartData.addRow(bridge);
    assertEqual(bridge.categories, ['Início', 'Aumento', '', 'Fim']);
    assertEqual(bridge.roles, ['start', 'delta', 'delta', 'end']);
    assertEqual(bridge.series[0].values, [100, 30, null, 130]);
    assertEqual(bridge.estimates, [false, false, false, true]);
});

test('chart data: removing and moving a row takes its name, estimate, role and values with it', () => {
    const bridge = sampleBridge();
    App.chartData.moveRow(bridge, 2, 0);
    assertEqual([bridge.categories, bridge.roles, bridge.estimates, bridge.series[0].values],
        [['Fim', 'Início', 'Aumento'], ['end', 'start', 'delta'], [true, false, false], [130, 100, 30]]);
    App.chartData.removeRow(bridge, 1);
    assertEqual([bridge.categories, bridge.roles, bridge.series[0].values], [['Fim', 'Aumento'], ['end', 'delta'], [130, 30]]);
});

test('chart data: series added (empty), removed and moved; a CAGR on a moved series follows it', () => {
    const data = sampleColumns();
    App.chartData.addSeries(data);
    assertEqual(data.series[2], { name: 'Série 3', values: [null, null, null] });
    App.chartData.removeSeries(data, 2);
    assertEqual(data.series.length, 2);
    data.options.cagr = { series: 0, from: 0, to: 2 };
    App.chartData.moveSeries(data, 0, 1);
    assertEqual(data.series.map((series) => series.name), ['EBITDA', 'Receita']);
    assertEqual(data.options.cagr.series, 1);
    App.chartData.removeSeries(data, 1);
    assertEqual(data.options.cagr, undefined, 'its series gone: no CAGR');
});

test('chart data: a row the CAGR runs to stays its end when rows move; a removed end drops it', () => {
    const data = sampleColumns();
    data.options.cagr = { series: 0, from: 0, to: 2 };
    App.chartData.moveRow(data, 2, 1);
    assertEqual(data.options.cagr, { series: 0, from: 0, to: 1 });
    App.chartData.removeRow(data, 1);
    assertEqual(data.options.cagr, undefined);
});

// ---------------------------------------------------------------------------
// Paste from Excel (Phase 6 step 8)
// ---------------------------------------------------------------------------

const COMPS_ROWS = [
    ['Empresa', 'EV (R$ mn)', 'EV/EBITDA', 'Margem EBITDA'],
    ['Alfa', '2.450', '9,8x', '19,50%'],
    ['Beta', '1.120', '(1,2x)', '-3,50%'],
];

test('chart data: a whole table has names across its first row; a block of numbers does not', () => {
    assert(App.chartData.isWholeTable(COMPS_ROWS), 'comps');
    assert(App.chartData.isWholeTable([['', 'Receita', 'EBITDA'], ['2022', '100', '30']]), 'years down the side are names too');
    assert(!App.chartData.isWholeTable([['100', '30'], ['120', '36']]), 'numbers only');
    assert(!App.chartData.isWholeTable([['Alfa', '10'], ['Beta', '20']]), 'names down the side, no header row');
});

test('chart data: a whole table replaces the data: names, series, %, estimates; colours of kept series stay', () => {
    const data = sampleColumns();
    data.series[0].color = '#00b050';
    data.options.cagr = { series: 0, from: 0, to: 2 };
    App.chartData.fromRows(data, COMPS_ROWS, 'pt-BR');
    assertEqual(data.categories, ['Alfa', 'Beta']);
    assertEqual(data.series.map((series) => series.name), ['EV (R$ mn)', 'EV/EBITDA', 'Margem EBITDA']);
    assertEqual(data.series.map((series) => series.values), [[2450, 1120], [9.8, -1.2], [0.195, -0.035]]);
    assertEqual([data.series[0].color, data.series[2].format], ['#00b050', 'percent']);
    assertEqual(data.options.cagr, undefined, 'the CAGR pointed past the new rows');
    const years = sampleBridge();
    App.chartData.fromRows(years, [['', 'R$ mn'], ['EBITDA 2024', '240'], ['Novos parques', '95'], ['EBITDA 2026E', '335']], 'pt-BR');
    assertEqual([years.estimates, years.roles], [[false, false, true], undefined], '2026E an estimate; a bridge\'s roles back to first / last');
});

test('chart data: a block of numbers fills from the cell, adding rows and series as needed', () => {
    const data = sampleColumns();
    App.chartData.fillRows(data, [['300'], ['400'], ['500']], 1, 0, 'pt-BR');
    assertEqual(data.series[0].values, [100, 300, 400, 500]);
    assertEqual(data.categories.length, 4);
    App.chartData.fillRows(data, [['Alfa', '10', '1', '7']], 0, -1, 'pt-BR');
    assertEqual([data.categories[0], data.series[0].values[0], data.series[1].values[0], data.series.length, data.series[2].values[0]],
        ['Alfa', 10, 1, 3, 7]);
});
