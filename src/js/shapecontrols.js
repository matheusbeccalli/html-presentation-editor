/*
 * shapecontrols.js - Insert > Shapes and Shape Format (SPEC Phase 5).
 *
 * Insert > Shapes: the gallery shows the kinds of shapes.js as icons; picking
 * one runs the insertShape command, which waits for a drag (or a click) on
 * the slide (selection.armInsert). Esc or a press outside closes the gallery.
 *
 * Shape Format (a tab shown while a shape is selected, and "Fill & line" in
 * the Format pane): fill, outline colour, width and dashes, transparency and
 * shadow, through shapes.setLook; each change is one undo step. A line has no
 * fill; its outline colour colours its arrow head too. Choosing a width or a
 * dash for a shape without an outline gives it one (the last outline colour).
 *
 * Talks to: shapes.js (the kinds, lookOf / setLook), commands.js, icons.js,
 *           textcontrols.js (colour split buttons, lists), history.js, selection.js.
 */

(function () {
    'use strict';

    App.shapeControls = {};

    const el = (...args) => App.util.el(...args);

    let shapesButton = null;
    let gallery = null;

    const WEIGHTS = [1, 1.5, 2, 3, 4, 6, 8];
    const DASH_LABELS = [['solid', 'Solid'], ['dash', 'Dashed'], ['dot', 'Dotted'], ['dashDot', 'Dash dot']];
    const TRANSPARENCIES = [0, 25, 50, 75];
    let lastFill = 'var(--color-accent, #1F2A44)';   // what the Fill button's main part applies
    let lastOutline = '#000000';
    const listButtons = {};   // name -> the list button on the ribbon

    // ---------------------------------------------------------------
    // Shape Format: the selected shape and its commands
    // ---------------------------------------------------------------

    /* The selected shape that Shape Format can change (older plain-box shapes cannot), or null. */
    function selectedShape() {
        const element = App.selection.getElement();
        return element && element.getAttribute('data-type') === 'shape' && element.hasAttribute('data-shape') ? element : null;
    }

    App.shapeControls.isShapeSelected = function isShapeSelected() {
        return !!selectedShape();
    };

    function isLineSelected() {
        const element = selectedShape();
        return !!element && App.shapes.isLine(element.getAttribute('data-shape'));
    }

    App.shapeControls.currentLook = function currentLook() {
        const element = selectedShape();
        return element ? App.shapes.lookOf(element) : null;
    };

    /* One undo step changing the selected shape's look; a width or dash on a shape without outline adds one. */
    function changeLook(label, changes) {
        const element = selectedShape();
        if (!element) {
            return;
        }
        const needsOutline = (changes.width !== undefined || changes.dash !== undefined) && changes.outline === undefined &&
            App.shapes.lookOf(element).outline === 'none';
        const all = needsOutline ? Object.assign({ outline: lastOutline }, changes) : changes;
        App.history.change(label, { slideId: element.closest('section.slide').getAttribute('data-slide-id') },
            () => App.shapes.setLook(element, all));
    }

    /* The Shape Format commands, defined in commands.js. */
    App.shapeControls.commands = function commands() {
        const isShape = () => App.shapeControls.isShapeSelected();
        const hasFill = () => isShape() && !isLineSelected();
        return {
            shapeFill: { label: 'Shape Fill', isEnabled: hasFill, run: () => changeLook('Shape fill', { fill: lastFill }) },
            setShapeFill: {
                label: 'Shape Fill', isEnabled: hasFill,
                run: (value) => {
                    if (value !== 'none') {
                        lastFill = value;
                    }
                    changeLook('Shape fill', { fill: value });
                },
            },
            shapeOutline: { label: 'Shape Outline', isEnabled: isShape, run: () => changeLook('Shape outline', { outline: lastOutline }) },
            setShapeOutline: {
                label: 'Shape Outline', isEnabled: isShape,
                run: (value) => {
                    if (value !== 'none') {
                        lastOutline = value;
                    }
                    changeLook('Shape outline', { outline: value });
                },
            },
            setShapeOutlineWidth: { label: 'Outline width', isEnabled: isShape, run: (px) => changeLook('Shape outline width', { width: px }) },
            setShapeDash: { label: 'Dashes', isEnabled: isShape, run: (dash) => changeLook('Shape outline dash', { dash: dash }) },
            setShapeTransparency: {
                label: 'Transparency', isEnabled: isShape, run: (percent) => changeLook('Shape transparency', { transparency: percent }),
            },
            shapeShadow: {
                label: 'Shadow', isEnabled: isShape,
                isChecked: () => !!App.shapeControls.currentLook() && App.shapeControls.currentLook().shadow,
                run: () => changeLook('Shape shadow', { shadow: !App.shapeControls.currentLook().shadow }),
            },
        };
    };

    // ---------------------------------------------------------------
    // Shape Format: ribbon controls
    // ---------------------------------------------------------------

    function colorControl(kind, menuClass) {
        const fill = kind === 'fill';
        return App.textControls.colorSplit({
            label: fill ? 'Shape Fill' : 'Shape Outline', icon: fill ? 'shapeFill' : 'shapeOutline',
            command: fill ? 'shapeFill' : 'shapeOutline', menuClass: menuClass, palette: 'theme',
            extras: [[fill ? 'No Fill' : 'No Outline', 'none']],
            current: () => (fill ? lastFill : lastOutline),
            choose: (value) => App.commands.run(fill ? 'setShapeFill' : 'setShapeOutline', value),
            isEnabled: () => App.commands.isEnabled(fill ? 'shapeFill' : 'shapeOutline'),
        });
    }

    /* A "2 px ▾" style button opening a list (className-menu). */
    function listControl(name, className, title, items) {
        const button = el('button', {
            type: 'button', class: 'ribbon-button small named list-button ' + className, title: title, 'aria-label': title,
            'aria-haspopup': 'menu',
            onclick: () => (App.textControls.isMenuOpen(className + '-menu') ? App.textControls.closeMenu()
                : App.textControls.openMenu(button, className + '-menu', items(), (value) => App.commands.run(name, value))),
        });
        listButtons[className] = button;
        return button;
    }

    function weightItems() {
        const look = App.shapeControls.currentLook();
        return WEIGHTS.map((weight) => ({ label: weight + ' px', value: weight, checked: !!look && look.width === weight }));
    }

    function dashItems() {
        const look = App.shapeControls.currentLook();
        return DASH_LABELS.map(([dash, label]) => ({ label: label, value: dash, checked: !!look && look.dash === dash }));
    }

    function transparencyItems() {
        const look = App.shapeControls.currentLook();
        return TRANSPARENCIES.map((percent) => ({ label: percent + '%', value: percent, checked: !!look && look.transparency === percent }));
    }

    /* Show the selected shape's width, dash and transparency on the list buttons. */
    App.shapeControls.refresh = function refresh() {
        const look = App.shapeControls.currentLook();
        const labels = {
            'shape-weight': look && look.outline !== 'none' ? look.width + ' px' : 'Width',
            'shape-dash': look ? DASH_LABELS.find(([dash]) => dash === look.dash)[1] : 'Dashes',
            'shape-transparency': look ? 'Transparency ' + look.transparency + '%' : 'Transparency',
        };
        Object.keys(listButtons).forEach((className) => {
            const button = listButtons[className];
            if (button.isConnected) {
                button.textContent = labels[className] + ' ▾';
                button.disabled = !look;
            }
        });
    };
    function iconName(kind) {
        return 'shape' + kind.charAt(0).toUpperCase() + kind.slice(1);
    }

    function closeGallery() {
        if (gallery) {
            gallery.remove();
            gallery = null;
            window.removeEventListener('pointerdown', onOutsidePointerDown, true);
            shapesButton.setAttribute('aria-expanded', 'false');
        }
    }

    function onOutsidePointerDown(event) {
        if (gallery && !gallery.contains(event.target) && !shapesButton.contains(event.target)) {
            closeGallery();
        }
    }

    function onGalleryKey(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            closeGallery();
            shapesButton.focus();
        }
    }

    function openGallery() {
        closeGallery();
        const items = App.shapes.KINDS.map((entry) => {
            const item = el('button', {
                type: 'button', class: 'shape-gallery-item', 'data-shape': entry.kind, title: entry.label, 'aria-label': entry.label,
                onclick: () => {
                    closeGallery();
                    App.commands.run('insertShape', entry.kind);
                },
            });
            item.innerHTML = App.icons.get(iconName(entry.kind));
            return item;
        });
        gallery = el('div', {
            class: 'menu shape-gallery', role: 'dialog', 'aria-label': 'Insert a shape', tabindex: '-1', onkeydown: onGalleryKey,
        }, [el('div', { class: 'table-grid-label' }, ['Shapes']), el('div', { class: 'shape-gallery-grid' }, items)]);
        const rect = shapesButton.getBoundingClientRect();
        gallery.style.left = rect.left + 'px';
        gallery.style.top = rect.bottom + 'px';
        document.body.appendChild(gallery);
        shapesButton.setAttribute('aria-expanded', 'true');
        window.addEventListener('pointerdown', onOutsidePointerDown, true);
        items[0].focus();
    }

    function createShapesButton() {
        shapesButton = el('button', {
            type: 'button', class: 'ribbon-button shapes-button', title: 'Insert a shape', 'aria-label': 'Shapes',
            'aria-haspopup': 'dialog', 'aria-expanded': 'false',
            onclick: () => (gallery ? closeGallery() : openGallery()),
        });
        shapesButton.innerHTML = App.icons.get('shapes');
        shapesButton.appendChild(el('span', { class: 'ribbon-button-label' }, ['Shapes ▾']));
        return shapesButton;
    }

    /* The control named in the ribbon's layout, or null when it is not a shape control. */
    App.shapeControls.create = function create(name) {
        switch (name) {
            case 'insertShape': return createShapesButton();
            case 'shapeFill': return colorControl('fill', 'shape-fill-menu');
            case 'shapeOutline': return colorControl('outline', 'shape-outline-menu');
            case 'shapeWeight': return listControl('setShapeOutlineWidth', 'shape-weight', 'Outline width', weightItems);
            case 'shapeDash': return listControl('setShapeDash', 'shape-dash', 'Dashes', dashItems);
            case 'shapeTransparency': return listControl('setShapeTransparency', 'shape-transparency', 'Transparency', transparencyItems);
            default: return null;
        }
    };

    // ---------------------------------------------------------------
    // Shape Format: the Format pane's "Fill & line"
    // ---------------------------------------------------------------

    let pane = null;   // { section, fillRow: [nodes], transparency, width, dash, shadow }

    /* A typed number between low and high (a decimal comma is fine), else null. */
    function typedNumber(input, low, high) {
        const value = App.formatPane.parseNumber(input.value.replace('%', ''));
        return value !== null && value >= low && value <= high ? value : null;
    }

    function numberField(input, low, high, command) {
        const apply = () => {
            const value = typedNumber(input, low, high);
            // A command runs a moment later (a Promise): show the field once the shape has changed.
            const done = value !== null ? App.commands.run(command, value) : Promise.resolve();
            done.then(() => refreshPane(true));
        };
        input.addEventListener('change', apply);
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                apply();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                refreshPane(true);
            }
        });
    }

    function refreshPane(force) {
        const look = App.shapeControls.currentLook();
        pane.section.hidden = !look;
        if (!look) {
            return;
        }
        pane.fillRow.forEach((node) => { node.hidden = isLineSelected(); });
        [[pane.transparency, String(look.transparency)], [pane.width, look.outline === 'none' ? '' : String(look.width)]]
            .forEach(([input, value]) => {
                if (force || document.activeElement !== input) {
                    input.value = value;
                }
            });
        pane.dash.value = look.dash;
        pane.shadow.checked = look.shadow;
    }

    /* Wiring, called once from App.start(): the Format pane's section. */
    App.shapeControls.init = function init() {
        const section = document.getElementById('format-shape');
        pane = {
            section: section,
            fillRow: Array.from(section.querySelectorAll('.format-shape-fill-row')),
            transparency: document.getElementById('format-shape-transparency'),
            width: document.getElementById('format-shape-width'),
            dash: document.getElementById('format-shape-dash'),
            shadow: document.getElementById('format-shape-shadow'),
        };
        document.getElementById('format-shape-fill').appendChild(colorControl('fill', 'pane-shape-fill-menu'));
        document.getElementById('format-shape-outline').appendChild(colorControl('outline', 'pane-shape-outline-menu'));
        DASH_LABELS.forEach(([dash, label]) => pane.dash.appendChild(el('option', { value: dash }, [label])));
        numberField(pane.transparency, 0, 100, 'setShapeTransparency');
        numberField(pane.width, 0.25, 100, 'setShapeOutlineWidth');
        pane.dash.addEventListener('change', () => App.commands.run('setShapeDash', pane.dash.value));
        pane.shadow.addEventListener('change', () => {
            const look = App.shapeControls.currentLook();
            if (look && look.shadow !== pane.shadow.checked) {
                App.commands.run('shapeShadow');
            }
        });
        ['selection-changed', 'history-changed', 'slide-changed', 'deck-loaded', 'selection-dragged'].forEach((name) => {
            App.events.on(name, () => refreshPane(false));
        });
        refreshPane(false);
    };
})();
