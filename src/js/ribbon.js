/*
 * ribbon.js - the PowerPoint-style ribbon: a File menu and tabs (SPEC 4).
 *
 * Tabs: Home, Insert, Arrange, Slide Show, Export, and contextual tabs shown
 * only while they apply (Table Design and Layout, Picture Format, Shape Format, Chart Design). In Phase 1 only Home has
 * buttons (undo/redo, slide navigation); the other tabs say which phase
 * fills them. Buttons only name a command; commands.js does the work.
 *
 * Talks to: commands.js, icons.js, shortcuts.js (to show key hints in tooltips),
 *           textcontrols.js, tablecontrols.js, tabledesign.js, shapecontrols.js and slides.js (controls that show a value or open a picker).
 */

(function () {
    'use strict';

    App.ribbon = {};

    const el = (...args) => App.util.el(...args);

    const TABS = [
        {
            id: 'home', label: 'Home',
            groups: [
                // A third entry: the command a double-click runs (the format painter stays on).
                { label: 'Clipboard', commands: [['paste', 'paste'], ['cut', 'cut'], ['copy', 'copy'], ['duplicate', 'duplicate'],
                    ['formatPainter', 'formatPainter', 'formatPainterLocked']] },
                { label: 'History', commands: [['undo', 'undo'], ['redo', 'redo']] },
                // Text groups: rows of small buttons (the name shows on hover), as in PowerPoint.
                {
                    label: 'Font',
                    rows: [[{ control: 'fontFamily' }, { control: 'fontSize' }, ['growFont', 'growFont'],
                        ['shrinkFont', 'shrinkFont'], ['clearFormatting', 'clearFormatting']],
                        [['bold', 'bold'], ['italic', 'italic'], ['underline', 'underline'],
                            ['strikethrough', 'strikethrough'], ['superscript', 'superscript'], ['subscript', 'subscript'],
                            { control: 'fontColor' }, { control: 'highlight' }]],
                },
                {
                    label: 'Paragraph',
                    rows: [[['bullets', 'bullets'], ['numbering', 'numbering'], ['decreaseIndent', 'outdent'],
                        ['increaseIndent', 'indent'], ['restartNumbering', 'restartNumbering'],
                        ['continueNumbering', 'continueNumbering']],
                    [['alignLeft', 'alignLeft'], ['alignCenter', 'alignCenter'], ['alignRight', 'alignRight'],
                        ['alignJustify', 'alignJustify'], { control: 'lineSpacing' }]],
                },
                { label: 'Slides', commands: [{ control: 'newSlide' }, ['duplicateSlide', 'duplicateSlide'],
                    ['deleteSlide', 'deleteSlide'], ['previousSlide', 'previous'], ['nextSlide', 'next']] },
                // Small buttons with their names, stacked, as PowerPoint's Editing group.
                { label: 'Editing', rows: [[{ command: 'find', icon: 'find' }], [{ command: 'replace', icon: 'replace' }]] },
            ],
            note: 'Double-click a text box (or press Enter) to type in it; Esc stops typing. ' +
                'With a box selected, Font and Paragraph change all its text.',
        },
        {
            id: 'insert', label: 'Insert',
            groups: [
                { label: 'Tables', commands: [{ control: 'insertTable' }] },
                { label: 'Images', commands: [['insertPicture', 'picture']] },
                { label: 'Illustrations', commands: [{ control: 'insertShape' }, { control: 'insertChart' }] },
                { label: 'Text', commands: [['insertTextBox', 'textBox']] },
            ],
            note: 'Table: move over the grid to pick a size, click to insert. Pictures: from a file, made smaller on the way ' +
                'in. Shapes: pick one, then drag on the slide (Shift keeps its proportions) or click. Text box: click it, then click on ' +
                'the slide (or drag to set its width). Chart: pick a type; it comes with made-up numbers to type over.',
        },
        {
            // Shown only while a table is selected (PowerPoint's Table Design tab).
            id: 'table-design', label: 'Table Design', contextual: () => App.tableControls.isTableSelected(),
            groups: [
                { label: 'Table Style Options', commands: [{ control: 'tableStyleOptions' }] },
                { label: 'Shading & Borders', rows: [[{ control: 'cellFill' }, { control: 'cellBorders' }],
                    [{ control: 'penWeight' }, { control: 'penColor' }]] },
                { label: 'Number', rows: [[{ control: 'numberLocale' }],
                    [['numberThousands', 'numberThousands'], ['increaseDecimals', 'increaseDecimals'],
                        ['decreaseDecimals', 'decreaseDecimals'], ['numberPercent', 'numberPercent'], ['negativeParens', 'negativeParens']]] },
            ],
            note: 'These change the selected cells, the cell you type in, or (table selected, Esc after typing) all its cells. ' +
                'Borders draw with the pen. Number buttons rewrite the numbers as 1.234,5 or 1,234.5 (chosen above them).',
        },
        {
            // Shown only while a table is selected (PowerPoint's Table Layout tab).
            id: 'table-layout', label: 'Layout', contextual: () => App.tableControls.isTableSelected(),
            groups: [
                { label: 'Delete', commands: [['deleteRows', 'deleteRows'], ['deleteColumns', 'deleteColumns'],
                    ['deleteTable', 'deleteTable']] },
                { label: 'Rows & Columns', commands: [['insertRowAbove', 'insertRowAbove'], ['insertRowBelow', 'insertRowBelow'],
                    ['insertColumnLeft', 'insertColumnLeft'], ['insertColumnRight', 'insertColumnRight']] },
                { label: 'Merge', commands: [['mergeCells', 'mergeCells'], ['splitCells', 'splitCells']] },
                { label: 'Alignment', rows: [[['cellAlignTop', 'cellAlignTop'], ['cellAlignMiddle', 'cellAlignMiddle'],
                    ['cellAlignBottom', 'cellAlignBottom']], [{ control: 'cellMargins' }]] },
            ],
            note: 'Click in a cell, or drag across cells to select several (Shift+click too). Delete empties the selected cells. ' +
                'Drag a table by its edge to move it.',
        },
        {
            // Shown only while a picture is selected (PowerPoint's Picture Format tab).
            id: 'picture-format', label: 'Picture Format', contextual: () => App.images.isPictureSelected(),
            groups: [
                { label: 'Adjust', commands: [['changePicture', 'changePicture']] },
                { label: 'Size', commands: [['cropPicture', 'crop'], ['resetPictureSize', 'resetPictureSize']] },
            ],
            note: 'Crop: drag the black handles, then Enter or click elsewhere; the cut-away part is removed from the file. ' +
                'Change Picture: the new picture fits inside this one\'s box. Reset Size: the size it came in with.',
        },
        {
            // Shown only while a shape is selected (PowerPoint's Shape Format tab).
            id: 'shape-format', label: 'Shape Format', contextual: () => App.shapeControls.isShapeSelected(),
            groups: [
                { label: 'Shape Styles', rows: [[{ control: 'shapeFill' }, { control: 'shapeOutline' }],
                    [{ control: 'shapeWeight' }, { control: 'shapeDash' }]] },
                { label: 'Effects', rows: [[{ control: 'shapeTransparency' }], [{ command: 'shapeShadow', icon: 'shadow' }]] },
            ],
            note: 'Fill and Outline: the button applies the colour on its bar, ▾ picks another. A width or a dash gives a shape ' +
                'without an outline one. Transparency is of the fill (of the line for lines). Also in the Format pane.',
        },
        {
            // Shown only while a chart is selected (PowerPoint's Chart Design tab).
            id: 'chart-design', label: 'Chart Design', contextual: () => App.chartControls.isChartSelected(),
            groups: [
                { label: 'Type', commands: [{ control: 'chartType' }] },
                { label: 'Data', commands: [['editChartData', 'table']] },
                { label: 'Chart Elements', rows: [
                    [{ command: 'chartTitle', icon: 'chartTitle' }, { command: 'chartDataLabels', icon: 'dataLabels' },
                        { command: 'chartGridlines', icon: 'gridlines' }],
                    [{ control: 'chartLegend' }, { control: 'chartLabelPosition' }, { command: 'chartCagr', icon: 'cagr' }]] },
                { label: 'Waterfall', rows: [[{ control: 'waterfallIncrease' }, { control: 'waterfallDecrease' },
                    { control: 'waterfallTotal' }]] },
            ],
            note: 'Title, axis titles, axis minimum / maximum, gap width and the source line are typed in the Format pane. ' +
                'Waterfall: the colours of increases, decreases and totals.',
        },
        {
            id: 'arrange', label: 'Arrange',
            groups: [
                {
                    label: 'Order',
                    commands: [['bringToFront', 'front'], ['bringForward', 'forward'],
                        ['sendBackward', 'backward'], ['sendToBack', 'back']],
                },
            ],
            note: 'Align, distribute, group and rotate arrive in Phase 7.',
        },
        {
            id: 'slideshow', label: 'Slide Show',
            groups: [{ label: 'Set Up', commands: [['hideSlide', 'hidden']] }],
            note: 'Presenting from the editor arrives in Phase 8. Saved decks already present on their own: open the saved file in the browser and use the arrow keys (F = full screen).',
        },
        { id: 'export', label: 'Export', note: 'PDF, PNG and PowerPoint export arrive in Phase 8.' },
    ];

    const FILE_MENU = [
        ['newDeck', 'newDeck', ''],
        ['open', 'open', 'Ctrl+O'],
        ['openRecent', 'recent', ''],
        ['save', 'save', 'Ctrl+S'],
        ['saveAs', 'saveAs', 'Ctrl+Shift+S'],
        ['revertToOpened', 'undo', ''],
        ['settings', 'settings', ''],
    ];

    let panel = null;
    let fileMenu = null;
    const buttons = [];   // [{ button, command }] so enabled states can be refreshed

    /* A ribbon button; small ones show only the icon (the name is in the tooltip). */
    function commandButton(command, iconName, small, doubleClickCommand, named) {
        const keys = App.shortcuts.keysFor(command);
        const button = el('button', {
            type: 'button', class: 'ribbon-button' + (small ? ' small' : '') + (named ? ' named' : ''),
            'aria-label': App.commands.label(command),
            title: App.commands.label(command) + (keys ? ' (' + keys + ')' : ''),
            'data-command': command,
            onclick: () => App.commands.run(command),
        });
        if (doubleClickCommand) {
            button.addEventListener('dblclick', () => App.commands.run(doubleClickCommand));
        }
        if (App.commands.keepsEdit(command)) {
            // Works on the text being edited: pressing it must not end editing (text.js) or
            // take the focus, and with it the cursor, out of the text.
            button.setAttribute('data-keep-edit', '');
            button.addEventListener('mousedown', (event) => event.preventDefault());
        }
        button.innerHTML = App.icons.get(iconName);
        if (!small || named) {
            button.appendChild(el('span', { class: 'ribbon-button-label' }, [App.commands.label(command)]));
        }
        buttons.push({ button: button, command: command });
        return button;
    }

    /* A control that shows a value or opens a picker (textcontrols.js, tablecontrols.js). */
    function createControl(name) {
        return App.slides.create(name) || App.tableControls.create(name) || App.tableDesign.create(name) || App.shapeControls.create(name) ||
            App.chartControls.create(name) || App.textControls.create(name);
    }

    function renderTab(tab) {
        panel.innerHTML = '';
        // Forget the buttons of the tab shown before (the File menu's stay).
        for (let i = buttons.length - 1; i >= 0; i--) {
            if (!buttons[i].button.isConnected) {
                buttons.splice(i, 1);
            }
        }
        (tab.groups || []).forEach((group) => {
            const groupNode = el('div', { class: 'ribbon-group' });
            let buttonsNode;
            if (group.rows) {
                buttonsNode = el('div', { class: 'ribbon-rows' }, group.rows.map((row) =>
                    el('div', { class: 'ribbon-row' }, row.map((item) => {
                        if (item.control) {
                            return createControl(item.control);
                        }
                        return item.command ? commandButton(item.command, item.icon, true, null, true) : commandButton(item[0], item[1], true);
                    }))));
            } else {
                buttonsNode = el('div', { class: 'ribbon-group-buttons' });
                group.commands.forEach((item) => buttonsNode.appendChild(item.control
                    ? createControl(item.control) : commandButton(item[0], item[1], false, item[2])));
            }
            groupNode.append(buttonsNode, el('div', { class: 'ribbon-group-label' }, [group.label]));
            panel.appendChild(groupNode);
        });
        if (tab.note) {
            panel.appendChild(el('div', { class: 'ribbon-note', title: tab.note }, [tab.note]));
        }
        App.ribbon.refresh();
    }

    function selectTab(tabId) {
        document.querySelectorAll('.ribbon-tab').forEach((tabButton) => {
            const selected = tabButton.getAttribute('data-tab') === tabId;
            tabButton.classList.toggle('selected', selected);
            tabButton.setAttribute('aria-selected', selected ? 'true' : 'false');
        });
        renderTab(TABS.find((tab) => tab.id === tabId));
    }

    function buildFileMenu() {
        fileMenu = el('div', { class: 'menu file-menu', role: 'menu', hidden: true });
        FILE_MENU.forEach(([command, icon, keys]) => {
            const item = el('button', {
                type: 'button', class: 'menu-item', role: 'menuitem', 'data-command': command,
                onclick: () => {
                    closeFileMenu();
                    App.commands.run(command);
                },
            });
            item.innerHTML = App.icons.get(icon);
            item.append(el('span', { class: 'menu-label' }, [App.commands.label(command)]),
                el('span', { class: 'menu-keys' }, [keys]));
            buttons.push({ button: item, command: command });
            fileMenu.appendChild(item);
        });
        document.body.appendChild(fileMenu);
    }

    function openFileMenu(anchor) {
        const rect = anchor.getBoundingClientRect();
        fileMenu.style.left = rect.left + 'px';
        fileMenu.style.top = rect.bottom + 'px';
        fileMenu.hidden = false;
        App.ribbon.refresh();
        fileMenu.querySelector('button:not([disabled])').focus();
    }

    function closeFileMenu() {
        fileMenu.hidden = true;
    }

    App.ribbon.init = function init() {
        const tabRow = document.getElementById('ribbon-tabs');
        panel = document.getElementById('ribbon-panel');

        buildFileMenu();
        const fileButton = el('button', {
            type: 'button', class: 'ribbon-file-button', 'aria-haspopup': 'menu',
            onclick: (event) => {
                event.stopPropagation();   // otherwise the document click below closes it again
                if (fileMenu.hidden) {
                    openFileMenu(fileButton);
                } else {
                    closeFileMenu();
                }
            },
        }, ['File']);
        tabRow.appendChild(fileButton);

        TABS.forEach((tab) => {
            // Switching tabs is not an action: typing in a text box goes on (data-keep-edit, focus kept).
            tabRow.appendChild(el('button', {
                type: 'button', class: 'ribbon-tab' + (tab.contextual ? ' contextual' : ''), role: 'tab',
                'data-tab': tab.id, 'data-keep-edit': '', hidden: !!tab.contextual,
                onmousedown: (event) => event.preventDefault(),
                onclick: () => selectTab(tab.id),
            }, [tab.label]));
        });

        document.addEventListener('click', (event) => {
            if (!fileMenu.hidden && !fileMenu.contains(event.target)) {
                closeFileMenu();
            }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !fileMenu.hidden) {
                closeFileMenu();
            }
        });

        ['deck-loaded', 'history-changed', 'saved', 'selection-changed', 'slide-changed', 'clipboard-changed',
         'recent-changed', 'text-edit-changed', 'text-selection-changed', 'painter-changed', 'table-cells-changed', 'crop-changed',
         'chart-data-changed']
            .forEach((name) => App.events.on(name, App.ribbon.refresh));
    };

    /* Contextual tabs (Layout) show only while they apply; if the one open goes away, Home opens. */
    function showContextualTabs() {
        TABS.filter((tab) => tab.contextual).forEach((tab) => {
            const tabButton = document.querySelector('.ribbon-tab[data-tab="' + tab.id + '"]');
            const shown = tab.contextual();
            tabButton.hidden = !shown;
            if (!shown && tabButton.classList.contains('selected')) {
                selectTab('home');
            }
        });
    }

    App.ribbon.showDefaultTab = function showDefaultTab() {
        selectTab('home');
    };

    /* Grey out buttons whose command cannot run right now (e.g. Undo with nothing to undo);
       toggle buttons (Bullets …) show whether they are on. */
    App.ribbon.refresh = function refresh() {
        showContextualTabs();
        buttons.forEach(({ button, command }) => {
            button.disabled = !App.commands.isEnabled(command);
            const checked = App.commands.isChecked(command);
            if (checked !== null) {
                button.setAttribute('aria-pressed', checked ? 'true' : 'false');
            }
        });
        App.textControls.refresh();
        App.tableControls.refresh();
        App.tableDesign.refresh();
        App.shapeControls.refresh();
        App.chartControls.refresh();
        App.slides.refresh();
    };
})();
