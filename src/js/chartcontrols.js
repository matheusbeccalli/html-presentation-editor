/*
 * chartcontrols.js - Insert > Chart and Chart Design (SPEC 5.4, Phase 6).
 *
 * Insert > Chart: a gallery of the types charts.js draws; a pick puts a chart
 * with made-up numbers (charts.sampleData) in the middle of the slide, one undo
 * step, selected (decided in the Phase 6 Q&A: sample data to type over).
 *
 * Chart Design (a tab shown while a chart is selected) changes the chart's
 * options on the ribbon: type, title on / off, data labels, gridlines, legend,
 * the CAGR arrow, a waterfall's colours. The Format pane's "Chart" section
 * holds what is typed: title, axis titles, axis minimum / maximum, gap width,
 * source line. Every change rewrites the chart's JSON and draws it again
 * (charts.writeData) as one undo step.
 *
 * Talks to: charts.js, commands.js, icons.js, textcontrols.js (colour split
 * buttons, lists), elements.js (ids, on top), history.js, selection.js,
 * tabledesign.js (the number locale).
 */

(function () {
    'use strict';

    App.chartControls = {};

    const el = (...args) => App.util.el(...args);

    const NEW_CHART = { left: 240, top: 150, width: 800, height: 450 };
    const DEFAULT_TITLE = 'Título do gráfico';
    const LEGENDS = [['bottom', 'Bottom'], ['top', 'Top'], ['right', 'Right'], ['none', 'None']];
    const ICONS = {
        column: 'chartColumn', 'stacked-column': 'chartColumn', 'stacked-column-100': 'chartColumn',
        bar: 'chartBar', 'stacked-bar': 'chartBar', 'stacked-bar-100': 'chartBar', line: 'chartLine',
        area: 'chartArea', 'stacked-area': 'chartArea', combo: 'chartCombo', waterfall: 'chartWaterfall',
        donut: 'chartDonut', pie: 'chartDonut', scatter: 'chartScatter', bubble: 'chartScatter',
    };
    // Types the CAGR arrow goes on: columns (and lines) standing on a horizontal axis.
    const CAGR_TYPES = ['column', 'stacked-column', 'line', 'area', 'stacked-area', 'combo'];

    // ---------------------------------------------------------------
    // The selected chart and changes to it
    // ---------------------------------------------------------------

    /* The selected chart, if it carries data the editor can change (a picture of a chart cannot). */
    function selectedChart() {
        const element = App.selection.getElement();
        return element && element.getAttribute('data-type') === 'chart' && App.charts.readData(element) ? element : null;
    }

    App.chartControls.isChartSelected = function isChartSelected() {
        return !!selectedChart();
    };

    function currentData() {
        const figure = selectedChart();
        return figure ? App.charts.readData(figure) : null;
    }

    /* One undo step: change(data) edits a copy of the selected chart's data, which is stored and drawn. */
    function changeChart(label, change) {
        const figure = selectedChart();
        if (!figure) {
            return;
        }
        const data = App.charts.readData(figure);
        data.options = Object.assign({}, data.options);
        change(data);
        App.history.change(label, { slideId: figure.closest('section.slide').getAttribute('data-slide-id') },
            () => App.charts.writeData(figure, data));
    }

    /* One option set (or, with undefined / '', removed) as one undo step. */
    function setOption(label, name, value) {
        changeChart(label, (data) => {
            if (value === undefined || value === null || value === '') {
                delete data.options[name];
            } else {
                data.options[name] = value;
            }
        });
    }

    /* Insert > Chart: a chart of `type` with sample numbers in the middle of the slide, selected. */
    App.chartControls.insertChart = function insertChart(type) {
        const slide = App.deck.getCurrentSlide();
        if (!slide) {
            return null;
        }
        const doc = slide.ownerDocument;
        let figure = null;
        App.history.change('Insert chart', { slideId: slide.getAttribute('data-slide-id') }, () => {
            figure = App.charts.createChart(doc, App.charts.sampleData(type, App.tableDesign.numberLocale()), NEW_CHART,
                App.elements.freshId(doc));
            App.elements.addOnTop(slide, figure);
        });
        App.selection.select(figure);
        App.ui.setStatus('Sample numbers: type over them in the data grid (Format pane for titles)');
        return figure;
    };

    /* The Chart commands, defined in commands.js. */
    App.chartControls.commands = function commands() {
        const isChart = () => App.chartControls.isChartSelected();
        const isType = (types) => () => isChart() && types.indexOf(currentData().type) !== -1;
        return {
            insertChart: {
                label: 'Chart', isEnabled: () => App.state.hasDeck,
                run: (type) => {
                    App.text.exitEdit({ select: false });
                    App.chartControls.insertChart(type || 'column');
                },
            },
            setChartType: { label: 'Chart type', isEnabled: isChart, run: (type) => changeChart('Chart type', (data) => { data.type = type; }) },
            setChartLegend: { label: 'Legend', isEnabled: isChart, run: (position) => setOption('Legend', 'legend', position) },
            chartTitle: {
                label: 'Chart Title', isEnabled: isChart,
                isChecked: () => isChart() && !!currentData().options && !!currentData().options.title,
                run: () => changeChart('Chart title', (data) => {
                    if (data.options.title) {
                        data.options.hiddenTitle = data.options.title;   // kept, so the title comes back as it was
                        delete data.options.title;
                    } else {
                        data.options.title = data.options.hiddenTitle || DEFAULT_TITLE;
                        delete data.options.hiddenTitle;
                    }
                }),
            },
            chartDataLabels: {
                label: 'Data Labels', isEnabled: isChart,
                isChecked: () => isChart() && App.charts.labelsOn(currentData()),
                run: () => changeChart('Data labels', (data) => { data.options.dataLabels = !App.charts.labelsOn(data); }),
            },
            chartGridlines: {
                label: 'Gridlines', isEnabled: isChart,
                isChecked: () => isChart() && (currentData().options || {}).gridlines !== false,
                run: () => changeChart('Gridlines', (data) => { data.options.gridlines = data.options.gridlines === false; }),
            },
            chartCagr: {
                label: 'CAGR', isEnabled: isType(CAGR_TYPES),
                isChecked: () => isChart() && !!(currentData().options || {}).cagr,
                run: () => changeChart('CAGR', (data) => {
                    if (data.options.cagr) {
                        delete data.options.cagr;
                    } else {
                        // From the first category to the last, of the first series (change in the data later).
                        data.options.cagr = { series: 0, from: 0, to: Math.max((data.categories || []).length - 1, 1) };
                    }
                }),
            },
            setWaterfallColor: {
                label: 'Waterfall colour', isEnabled: isType(['waterfall']),
                run: (choice) => changeChart('Waterfall colour', (data) => {
                    data.options.waterfall = Object.assign({}, data.options.waterfall, { [choice.kind]: choice.value });
                }),
            },
            setChartOption: {
                label: 'Chart option', isEnabled: isChart,
                run: (choice) => setOption(choice.label, choice.name, choice.value),
            },
        };
    };

    // ---------------------------------------------------------------
    // Ribbon controls
    // ---------------------------------------------------------------

    let chartButton = null;
    let gallery = null;
    const listButtons = {};

    function closeGallery() {
        if (gallery) {
            gallery.remove();
            gallery = null;
            window.removeEventListener('pointerdown', onOutsidePointerDown, true);
            chartButton.setAttribute('aria-expanded', 'false');
        }
    }

    function onOutsidePointerDown(event) {
        if (gallery && !gallery.contains(event.target) && !chartButton.contains(event.target)) {
            closeGallery();
        }
    }

    function openGallery() {
        closeGallery();
        const items = App.charts.GALLERY.map((entry) => {
            const item = el('button', {
                type: 'button', class: 'chart-gallery-item', 'data-chart-type': entry.type, title: entry.label,
                onclick: () => {
                    closeGallery();
                    App.commands.run('insertChart', entry.type);
                },
            });
            item.innerHTML = App.icons.get(ICONS[entry.type]);
            item.appendChild(el('span', {}, [entry.label]));
            return item;
        });
        gallery = el('div', {
            class: 'menu chart-gallery', role: 'dialog', 'aria-label': 'Insert a chart', tabindex: '-1',
            onkeydown: (event) => {
                if (event.key === 'Escape') {
                    event.stopPropagation();
                    closeGallery();
                    chartButton.focus();
                }
            },
        }, [el('div', { class: 'table-grid-label' }, ['Charts']), el('div', { class: 'chart-gallery-grid' }, items)]);
        const rect = chartButton.getBoundingClientRect();
        gallery.style.left = rect.left + 'px';
        gallery.style.top = rect.bottom + 'px';
        document.body.appendChild(gallery);
        chartButton.setAttribute('aria-expanded', 'true');
        window.addEventListener('pointerdown', onOutsidePointerDown, true);
        items[0].focus();
    }

    function createChartButton() {
        chartButton = el('button', {
            type: 'button', class: 'ribbon-button chart-button', title: 'Insert a chart', 'aria-label': 'Chart',
            'aria-haspopup': 'dialog', 'aria-expanded': 'false',
            onclick: () => (gallery ? closeGallery() : openGallery()),
        });
        chartButton.innerHTML = App.icons.get('chartColumn');
        chartButton.appendChild(el('span', { class: 'ribbon-button-label' }, ['Chart ▾']));
        return chartButton;
    }

    /* A "Bottom ▾" style button opening a list (className-menu). */
    function listControl(className, title, items, onChoose) {
        const button = el('button', {
            type: 'button', class: 'ribbon-button small named list-button ' + className, title: title, 'aria-label': title,
            'aria-haspopup': 'menu',
            onclick: () => (App.textControls.isMenuOpen(className + '-menu') ? App.textControls.closeMenu()
                : App.textControls.openMenu(button, className + '-menu', items(), onChoose)),
        });
        listButtons[className] = button;
        return button;
    }

    function typeName(type) {
        const entry = App.charts.GALLERY.find((item) => item.type === type);
        return entry ? entry.label : type;
    }

    function waterfallColor(kind, label, fallback) {
        return App.textControls.colorSplit({
            label: label, icon: 'shapeFill', command: null, menuClass: 'waterfall-' + kind + '-menu', palette: 'theme',
            current: () => {
                const data = currentData();
                return (data && data.options && data.options.waterfall && data.options.waterfall[kind]) || fallback;
            },
            choose: (value) => App.commands.run('setWaterfallColor', { kind: kind, value: value }),
            isEnabled: () => App.commands.isEnabled('setWaterfallColor'),
        });
    }

    /* The control named in the ribbon's layout, or null when it is not a chart control. */
    App.chartControls.create = function create(name) {
        switch (name) {
            case 'insertChart': return createChartButton();
            case 'chartType':
                return listControl('chart-type', 'Chart type', () => {
                    const current = (currentData() || {}).type;
                    return App.charts.GALLERY.map((entry) => ({ label: entry.label, value: entry.type, checked: entry.type === current }));
                }, (type) => App.commands.run('setChartType', type));
            case 'chartLegend':
                return listControl('chart-legend', 'Legend', () => {
                    const current = ((currentData() || {}).options || {}).legend;
                    return LEGENDS.map(([value, label]) => ({ label: label, value: value, checked: value === current }));
                }, (position) => App.commands.run('setChartLegend', position));
            case 'waterfallIncrease': return waterfallColor('increase', 'Increase colour', '#3C9D5D');
            case 'waterfallDecrease': return waterfallColor('decrease', 'Decrease colour', '#D9534F');
            case 'waterfallTotal': return waterfallColor('total', 'Total colour', 'var(--color-accent, #1F2A44)');
            default: return null;
        }
    };

    /* The list buttons show the selected chart's type and legend. */
    App.chartControls.refresh = function refresh() {
        const data = currentData();
        const legend = data && data.options && data.options.legend;
        const labels = {
            'chart-type': data ? typeName(data.type) : 'Type',
            'chart-legend': 'Legend: ' + (legend ? LEGENDS.find(([value]) => value === legend)[1] : 'Auto'),
        };
        Object.keys(listButtons).forEach((className) => {
            const button = listButtons[className];
            if (button.isConnected) {
                button.textContent = labels[className] + ' ▾';
                button.disabled = !data;
            }
        });
    };

    // ---------------------------------------------------------------
    // The Format pane's "Chart" section
    // ---------------------------------------------------------------

    // [field id, option, undo label, kind]: text fields, or numbers (empty = automatic).
    const FIELDS = [
        ['format-chart-title', 'title', 'Chart title', 'text'],
        ['format-chart-value-title', 'valueAxisTitle', 'Axis title', 'text'],
        ['format-chart-category-title', 'categoryAxisTitle', 'Axis title', 'text'],
        ['format-chart-min', 'axisMin', 'Axis minimum', 'number'],
        ['format-chart-max', 'axisMax', 'Axis maximum', 'number'],
        ['format-chart-gap', 'gapWidth', 'Gap width', 'number'],
        ['format-chart-source', 'source', 'Source', 'text'],
    ];
    let section = null;

    function refreshPane(force) {
        const data = currentData();
        section.hidden = !data;
        if (!data) {
            return;
        }
        const options = data.options || {};
        FIELDS.forEach(([id, name]) => {
            const input = document.getElementById(id);
            if (force || document.activeElement !== input) {
                input.value = options[name] === undefined || options[name] === null ? '' : String(options[name]);
            }
        });
    }

    function applyField(input, name, label, kind) {
        const options = (currentData() || {}).options || {};
        const typed = input.value.trim();
        let value = typed;
        if (kind === 'number' && typed !== '') {
            value = App.formatPane.parseNumber(typed);
            if (value === null) {
                App.ui.setStatus('Type a number, or leave it empty for automatic');
                refreshPane(true);
                return;
            }
        }
        const before = options[name] === undefined ? '' : options[name];
        // A command runs a moment later (a Promise): show the field once the chart has changed.
        const done = String(before) !== String(value)
            ? App.commands.run('setChartOption', { name: name, value: value, label: label }) : Promise.resolve();
        done.then(() => refreshPane(true));
    }

    /* Wiring, called once from App.start(): the Format pane's section. */
    App.chartControls.init = function init() {
        section = document.getElementById('format-chart');
        FIELDS.forEach(([id, name, label, kind]) => {
            const input = document.getElementById(id);
            input.addEventListener('change', () => applyField(input, name, label, kind));
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    applyField(input, name, label, kind);
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    refreshPane(true);
                }
            });
        });
        ['selection-changed', 'history-changed', 'slide-changed', 'deck-loaded'].forEach((name) => {
            App.events.on(name, () => refreshPane(false));
        });
        refreshPane(false);
    };
})();
