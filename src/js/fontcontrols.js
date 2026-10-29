/*
 * fontcontrols.js - the font list, the font size box and the colour buttons
 * of Home > Font (SPEC Phase 3).
 *
 * Unlike the other ribbon buttons, these show a value: the font and size of
 * the selected text (blank when the selection mixes them, as in PowerPoint).
 * Choosing a font or a size runs a command; the text keeps its selection.
 *
 * - The font list starts with the deck's theme fonts, shown with their real
 *   names ("Calibri (Headings)") and stored as var(--font-heading) /
 *   var(--font-body), so changing the theme restyles the text; then the
 *   Windows fonts of SPEC 2.1, each with a generic fallback.
 * - The size box takes a typed size (Enter applies it, Esc goes back to the
 *   text) or one from its list (App.text.FONT_SIZES).
 * - Font color and Highlight are split buttons, as in PowerPoint: the button
 *   applies the colour shown under its icon (the last one chosen), the arrow
 *   opens the colours: the deck's theme colours first (stored as
 *   var(--color-…)), then standard colours, and "More colors…".
 *
 * Talks to: commands.js (setFontFamily, setFontSize, setFontColor, setHighlight), text.js (what the
 * selection has), deck.js (the theme fonts), ribbon.js (places the controls).
 */

(function () {
    'use strict';

    App.fontControls = {};

    const el = (...args) => App.util.el(...args);

    const THEME_FONTS = [['--font-heading', 'Headings'], ['--font-body', 'Body']];
    const FONTS = [
        ['Arial', 'Arial, sans-serif'],
        ['Calibri', 'Calibri, sans-serif'],
        ['Cambria', 'Cambria, serif'],
        ['Consolas', 'Consolas, monospace'],
        ['Georgia', 'Georgia, serif'],
        ['Segoe UI', '"Segoe UI", sans-serif'],
        ['Times New Roman', '"Times New Roman", serif'],
        ['Verdana', 'Verdana, sans-serif'],
    ];

    // PowerPoint's standard colours and text highlight colours.
    const STANDARD_COLORS = [['Dark Red', '#c00000'], ['Red', '#ff0000'], ['Orange', '#ffc000'], ['Yellow', '#ffff00'],
        ['Light Green', '#92d050'], ['Green', '#00b050'], ['Light Blue', '#00b0f0'], ['Blue', '#0070c0'],
        ['Dark Blue', '#002060'], ['Purple', '#7030a0']];
    const HIGHLIGHT_COLORS = [['Yellow', '#ffff00'], ['Bright Green', '#00ff00'], ['Turquoise', '#00ffff'],
        ['Pink', '#ff00ff'], ['Blue', '#0000ff'], ['Red', '#ff0000'], ['Dark Blue', '#000080'], ['Teal', '#008080'],
        ['Green', '#008000'], ['Violet', '#800080'], ['Dark Red', '#800000'], ['Dark Yellow', '#808000'],
        ['Gray 50%', '#808080'], ['Gray 25%', '#c0c0c0'], ['Black', '#000000']];

    // The colour each split button applies: the last one chosen (null = its default).
    const lastColors = { color: null, 'background-color': null };

    let fontButton = null;
    let sizeInput = null;
    let menu = null;   // the one open list (fonts or sizes), or null

    /* "Calibri" from '"Calibri", Arial, sans-serif'. */
    function firstFamily(value) {
        return value.split(',')[0].trim().replace(/^["']|["']$/g, '');
    }

    /* The fonts a theme variable stands for in the open deck ("Calibri, Arial, sans-serif"), or ''. */
    function themeFontValue(variable) {
        const doc = App.deck.getDocument();
        return doc ? getComputedStyle(doc.documentElement).getPropertyValue(variable).trim() : '';
    }

    /* Its first font ("Calibri"), or null. */
    function themeFontName(variable) {
        const value = themeFontValue(variable);
        return value ? firstFamily(value) : null;
    }

    /* What the font box shows for a font-family value. */
    function fontLabel(value) {
        if (!value) {
            return '';
        }
        const theme = THEME_FONTS.find(([variable]) => value === 'var(' + variable + ')');
        if (theme) {
            return (themeFontName(theme[0]) || 'Theme font') + ' (' + theme[1] + ')';
        }
        return firstFamily(value);
    }

    /* Controls that work on the text being edited: a press on them keeps text editing. */
    function keepEdit(node) {
        node.setAttribute('data-keep-edit', '');
        return node;
    }

    function closeMenu() {
        if (menu) {
            menu.remove();
            menu = null;
            window.removeEventListener('pointerdown', onOutsidePointerDown, true);
            window.removeEventListener('keydown', onMenuKey, true);
        }
    }

    function onOutsidePointerDown(event) {
        if (menu && !menu.contains(event.target)) {
            closeMenu();
        }
    }

    function onMenuKey(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            closeMenu();
        }
    }

    /*
     * Open a list under `anchor`. items: [{ label, value, style }]; choosing one
     * calls onChoose(value). Its items never take the focus, so the text keeps
     * its cursor and selection.
     */
    function openMenu(anchor, className, items, onChoose) {
        closeMenu();
        menu = keepEdit(el('div', { class: 'menu ' + className, role: 'menu' }));
        items.forEach((item) => {
            if (item.separator) {
                menu.appendChild(el('div', { class: 'menu-separator', role: 'separator' }));
                return;
            }
            const button = el('button', {
                type: 'button', class: 'menu-item', role: 'menuitem',
                onmousedown: (event) => event.preventDefault(),
                onclick: () => {
                    closeMenu();
                    onChoose(item.value);
                },
            }, [el('span', { class: 'menu-label', style: item.style || null }, [item.label])]);
            menu.appendChild(button);
        });
        const rect = anchor.getBoundingClientRect();
        menu.style.left = rect.left + 'px';
        menu.style.top = rect.bottom + 'px';
        document.body.appendChild(menu);
        window.addEventListener('pointerdown', onOutsidePointerDown, true);
        window.addEventListener('keydown', onMenuKey, true);
    }

    function openFontMenu() {
        const themeItems = THEME_FONTS.map(([variable]) => ({
            label: fontLabel('var(' + variable + ')'), value: 'var(' + variable + ')',
            style: 'font-family: ' + (themeFontValue(variable) || 'inherit'),
        }));
        const fontItems = FONTS.map(([name, value]) => ({ label: name, value: value, style: 'font-family: ' + value }));
        openMenu(fontButton, 'font-family-menu', themeItems.concat([{ separator: true }], fontItems), (value) => {
            App.commands.run('setFontFamily', value);
        });
    }

    function openSizeMenu(anchor) {
        const items = App.text.FONT_SIZES.map((size) => ({ label: String(size), value: size + 'pt' }));
        openMenu(anchor, 'font-size-menu', items, (value) => App.commands.run('setFontSize', value));
    }

    /* A typed size: Enter applies it (1 to 999 pt), Esc goes back to the text unchanged. */
    function onSizeKey(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            const size = parseFloat(sizeInput.value.replace(',', '.'));
            if (size >= 1 && size <= 999) {
                App.commands.run('setFontSize', size + 'pt').then(() => App.text.refocus());
            } else {
                App.ui.setStatus('Type a font size between 1 and 999');
            }
        } else if (event.key === 'Escape') {
            event.preventDefault();
            App.text.refocus();
            App.fontControls.refresh();
        }
    }

    function createFontFamily() {
        fontButton = keepEdit(el('button', {
            type: 'button', class: 'font-family-button', title: 'Font', 'aria-haspopup': 'menu',
            onmousedown: (event) => event.preventDefault(),
            onclick: () => (menu && menu.classList.contains('font-family-menu') ? closeMenu() : openFontMenu()),
        }, [el('span', { class: 'font-name' }), el('span', { class: 'font-arrow', 'aria-hidden': 'true' }, ['▾'])]));
        return fontButton;
    }

    function createFontSize() {
        sizeInput = keepEdit(el('input', {
            type: 'text', class: 'font-size-input', title: 'Font size', 'aria-label': 'Font size', inputmode: 'decimal',
            onkeydown: onSizeKey,
            onblur: () => App.fontControls.refresh(),
        }));
        const arrow = keepEdit(el('button', {
            type: 'button', class: 'font-size-menu-button', title: 'Font sizes', 'aria-haspopup': 'menu',
            onmousedown: (event) => event.preventDefault(),
            onclick: () => (menu && menu.classList.contains('font-size-menu') ? closeMenu() : openSizeMenu(sizeInput)),
        }, ['▾']));
        return el('div', { class: 'font-size-box' }, [sizeInput, arrow]);
    }

    /* "Primary (theme)" for --color-primary. */
    function themeColorTitle(variable) {
        const words = variable.replace(/^--color-/, '').replace(/^bg$/, 'background').split('-');
        return words.map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(' ') + ' (theme)';
    }

    /* What a stored colour looks like on screen (a theme variable resolved in the deck). */
    function shownColor(value) {
        const match = /^var\((--[a-z0-9-]+)\)$/.exec(value || '');
        const doc = App.deck.getDocument();
        if (match && doc) {
            return getComputedStyle(doc.documentElement).getPropertyValue(match[1]).trim() || 'transparent';
        }
        return value || 'transparent';
    }

    /* The colour a split button applies now: the last chosen, else the theme's primary colour / yellow. */
    App.fontControls.currentColor = function currentColor(property) {
        if (lastColors[property] !== null) {
            return lastColors[property];
        }
        if (property === 'background-color') {
            return '#ffff00';
        }
        const doc = App.deck.getDocument();
        return doc && App.text.themeColorNames(doc).indexOf('--color-primary') !== -1 ? 'var(--color-primary)' : '#c00000';
    };

    /* A colour chosen from the list: it applies, and the button keeps it for next time. */
    function chooseColor(property, value) {
        lastColors[property] = value;
        App.commands.run(property === 'color' ? 'setFontColor' : 'setHighlight', value);
        App.fontControls.refresh();
    }

    function swatch(title, value, property) {
        return el('button', {
            type: 'button', class: 'color-swatch', title: title, 'aria-label': title, style: 'background: ' + shownColor(value),
            onmousedown: (event) => event.preventDefault(),
            onclick: () => {
                closeMenu();
                chooseColor(property, value);
            },
        });
    }

    /* The colours of a split button's arrow. */
    function openColorMenu(anchor, property) {
        closeMenu();
        menu = keepEdit(el('div', { class: 'menu color-menu ' + (property === 'color' ? 'font-color-menu' : 'highlight-menu'), role: 'menu' }));
        const section = (label, colors) => {
            menu.append(el('div', { class: 'color-menu-label' }, [label]),
                el('div', { class: 'color-grid' }, colors.map(([title, value]) => swatch(title, value, property))));
        };
        if (property === 'color') {
            const doc = App.deck.getDocument();
            const theme = doc ? App.text.themeColorNames(doc) : [];
            if (theme.length > 0) {
                section('Theme colors', theme.map((name) => [themeColorTitle(name), 'var(' + name + ')']));
            }
            section('Standard colors', STANDARD_COLORS);
        } else {
            menu.appendChild(el('button', {
                type: 'button', class: 'menu-item', title: 'No color', onmousedown: (event) => event.preventDefault(),
                onclick: () => {
                    closeMenu();
                    App.commands.run('setHighlight', null);
                },
            }, [el('span', { class: 'menu-label' }, ['No color'])]));
            section('Highlight colors', HIGHLIGHT_COLORS);
        }
        // Any colour: the browser's colour window (it takes the focus; the text gets it back after).
        const picker = el('input', { type: 'color', class: 'color-picker-input', tabindex: '-1' });
        picker.addEventListener('change', () => {
            chooseColor(property, picker.value);
            App.text.refocus();
            picker.remove();
        });
        menu.appendChild(el('button', {
            type: 'button', class: 'menu-item', onmousedown: (event) => event.preventDefault(),
            onclick: () => {
                closeMenu();
                keepEdit(picker);
                document.body.appendChild(picker);
                picker.click();
            },
        }, [el('span', { class: 'menu-label' }, ['More colors…'])]));
        const rect = anchor.getBoundingClientRect();
        menu.style.left = rect.left + 'px';
        menu.style.top = rect.bottom + 'px';
        document.body.appendChild(menu);
        window.addEventListener('pointerdown', onOutsidePointerDown, true);
        window.addEventListener('keydown', onMenuKey, true);
    }

    const colorButtons = {};   // property -> { main, arrow, bar }

    /* A split button: the main part applies the colour under the icon, the arrow lists colours. */
    function createColorButton(property) {
        const command = property === 'color' ? 'fontColor' : 'highlight';
        const main = keepEdit(el('button', {
            type: 'button', class: 'ribbon-button small color-main', 'data-command': command,
            title: App.commands.label(command), 'aria-label': App.commands.label(command),
            onmousedown: (event) => event.preventDefault(),
            onclick: () => App.commands.run(command),
        }));
        main.innerHTML = App.icons.get(command);
        const bar = el('span', { class: 'color-bar' });
        main.appendChild(bar);
        const arrow = keepEdit(el('button', {
            type: 'button', class: 'color-menu-button ' + (property === 'color' ? 'font-color-menu-button' : 'highlight-menu-button'),
            title: App.commands.label(command) + ': more colors', 'aria-haspopup': 'menu',
            onmousedown: (event) => event.preventDefault(),
            onclick: () => (menu && menu.classList.contains(property === 'color' ? 'font-color-menu' : 'highlight-menu')
                ? closeMenu() : openColorMenu(main, property)),
        }, ['▾']));
        colorButtons[property] = { main: main, arrow: arrow, bar: bar };
        return el('div', { class: 'color-split' }, [main, arrow]);
    }

    /* The control named in the ribbon's layout. */
    App.fontControls.create = function create(name) {
        if (name === 'fontColor') {
            return createColorButton('color');
        }
        if (name === 'highlight') {
            return createColorButton('background-color');
        }
        return name === 'fontFamily' ? createFontFamily() : createFontSize();
    };

    /* Show the selection's font and size; grey out when there is no text to format. */
    App.fontControls.refresh = function refresh() {
        if (!fontButton || !fontButton.isConnected) {
            return;
        }
        const enabled = App.commands.isEnabled('setFontFamily');
        const state = enabled ? App.text.currentStyleState() : {};
        fontButton.disabled = !enabled;
        fontButton.querySelector('.font-name').textContent = fontLabel(state.fontFamily);
        sizeInput.disabled = !enabled;
        sizeInput.nextSibling.disabled = !enabled;
        if (document.activeElement !== sizeInput) {
            sizeInput.value = state.fontSize ? String(state.fontSize) : '';
        }
        Object.keys(colorButtons).forEach((property) => {
            const parts = colorButtons[property];
            parts.main.disabled = !enabled;
            parts.arrow.disabled = !enabled;
            parts.bar.style.background = shownColor(App.fontControls.currentColor(property));
        });
    };
})();
