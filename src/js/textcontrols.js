/*
 * textcontrols.js - the ribbon's text controls that show a value or open a
 * list (SPEC Phase 3): Home > Font's font list, font size box and colour
 * buttons, and Home > Paragraph's line spacing list.
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
 * - Line spacing lists PowerPoint's values (1.0, 1.15 … 3.0) and takes the
 *   space before / after a paragraph in pt. PowerPoint's single spacing is
 *   about 1.2 times the font size, so "1.0" is stored as line-height: 1.2.
 *
 * Talks to: commands.js (setFontFamily, setFontSize, setFontColor, setHighlight,
 * setLineSpacing, setSpaceBefore, setSpaceAfter), text.js (what the selection
 * has), deck.js (the theme fonts and colours), ribbon.js (places the controls).
 */

(function () {
    'use strict';

    App.textControls = {};

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

    // Line spacing as PowerPoint names it; stored as line-height = value x SINGLE_LINE.
    const LINE_SPACINGS = [1, 1.15, 1.5, 2, 2.5, 3];
    const SINGLE_LINE = 1.2;

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

    /* Show `node` as the open list under `anchor`; a press outside it or Esc closes it. */
    function showMenu(anchor, node) {
        closeMenu();
        menu = keepEdit(node);
        const rect = anchor.getBoundingClientRect();
        menu.style.left = rect.left + 'px';
        menu.style.top = rect.bottom + 'px';
        document.body.appendChild(menu);
        // Near the right edge of the window, the list opens to the left instead.
        const overflow = menu.getBoundingClientRect().right - (window.innerWidth - 4);
        if (overflow > 0) {
            menu.style.left = Math.max(4, rect.left - overflow) + 'px';
        }
        window.addEventListener('pointerdown', onOutsidePointerDown, true);
        window.addEventListener('keydown', onMenuKey, true);
    }

    /*
     * Open a list under `anchor`. items: [{ label, value, style }]; choosing one
     * calls onChoose(value). Its items never take the focus, so the text keeps
     * its cursor and selection.
     */
    function openMenu(anchor, className, items, onChoose) {
        const list = el('div', { class: 'menu ' + className, role: 'menu' });
        items.forEach((item) => {
            if (item.separator) {
                list.appendChild(el('div', { class: 'menu-separator', role: 'separator' }));
                return;
            }
            const button = el('button', {
                type: 'button', class: 'menu-item', role: item.checked === undefined ? 'menuitem' : 'menuitemradio',
                'aria-checked': item.checked === undefined ? null : String(item.checked),
                onmousedown: (event) => event.preventDefault(),
                onclick: () => {
                    closeMenu();
                    onChoose(item.value);
                },
            }, [el('span', { class: 'menu-label', style: item.style || null }, [item.label])]);
            list.appendChild(button);
        });
        showMenu(anchor, list);
        return list;
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
            App.textControls.refresh();
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
            onblur: () => App.textControls.refresh(),
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
    App.textControls.currentColor = function currentColor(property) {
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
        App.textControls.refresh();
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
        const list = el('div', { class: 'menu color-menu ' + (property === 'color' ? 'font-color-menu' : 'highlight-menu'), role: 'menu' });
        const section = (label, colors) => {
            list.append(el('div', { class: 'color-menu-label' }, [label]),
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
            list.appendChild(el('button', {
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
        list.appendChild(el('button', {
            type: 'button', class: 'menu-item', onmousedown: (event) => event.preventDefault(),
            onclick: () => {
                closeMenu();
                keepEdit(picker);
                document.body.appendChild(picker);
                picker.click();
            },
        }, [el('span', { class: 'menu-label' }, ['More colors…'])]));
        showMenu(anchor, list);
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

    let lineSpacingButton = null;

    /* A space field of the line spacing list: Enter applies the typed pt, then the text gets the focus back. */
    function spaceField(label, className, command, value) {
        const input = el('input', {
            type: 'text', class: className, inputmode: 'decimal', 'aria-label': label + ' (pt)',
            value: value === null || value === undefined ? '' : String(value),
            onkeydown: (event) => {
                if (event.key !== 'Enter') {
                    return;
                }
                event.preventDefault();
                const points = parseFloat(input.value.replace(',', '.'));
                if (points >= 0 && points <= 999) {
                    closeMenu();
                    App.commands.run(command, points + 'pt').then(() => App.text.refocus());
                } else {
                    App.ui.setStatus('Type a space between 0 and 999 pt');
                }
            },
        });
        return el('label', { class: 'space-field' }, [el('span', {}, [label]), input, el('span', {}, ['pt'])]);
    }

    function openLineSpacingMenu() {
        const state = App.text.currentParagraphState();
        const items = LINE_SPACINGS.map((spacing) => {
            const css = Math.round(spacing * SINGLE_LINE * 1000) / 1000;
            return { label: spacing.toFixed(spacing === 1.15 ? 2 : 1), value: String(css), checked: state.lineHeight === css };
        });
        const list = openMenu(lineSpacingButton, 'line-spacing-menu', items, (value) => App.commands.run('setLineSpacing', value));
        list.append(el('div', { class: 'menu-separator', role: 'separator' }),
            spaceField('Space before', 'space-before-input', 'setSpaceBefore', state.spaceBefore),
            spaceField('Space after', 'space-after-input', 'setSpaceAfter', state.spaceAfter));
    }

    function createLineSpacing() {
        lineSpacingButton = keepEdit(el('button', {
            type: 'button', class: 'ribbon-button small line-spacing-button', title: 'Line spacing and paragraph spacing',
            'aria-label': 'Line spacing', 'aria-haspopup': 'menu',
            onmousedown: (event) => event.preventDefault(),
            onclick: () => (menu && menu.classList.contains('line-spacing-menu') ? closeMenu() : openLineSpacingMenu()),
        }));
        lineSpacingButton.innerHTML = App.icons.get('lineSpacing');
        lineSpacingButton.appendChild(el('span', { class: 'font-arrow', 'aria-hidden': 'true' }, ['▾']));
        return lineSpacingButton;
    }

    // ---- The paste options button (after a paste, at the end of the pasted text) ----

    let pasteButton = null;

    function openPasteMenu() {
        const choices = App.text.pasteOptions();
        if (!choices) {
            return;
        }
        const items = choices.options.map((option) => ({ label: option.label, value: option.mode,
            checked: option.mode === choices.current }));
        openMenu(pasteButton, 'paste-options-menu', items, (mode) => App.text.repaste(mode));
    }

    /* Show the button where the pasted text ends while the paste can be switched; hide it otherwise. */
    function refreshPasteButton() {
        if (!pasteButton) {
            pasteButton = keepEdit(el('button', {
                id: 'paste-options', type: 'button', class: 'paste-options-button', hidden: true,
                title: 'Paste options', 'aria-label': 'Paste options', 'aria-haspopup': 'menu',
                onmousedown: (event) => event.preventDefault(),
                onclick: () => (menu && menu.classList.contains('paste-options-menu') ? closeMenu() : openPasteMenu()),
            }));
            pasteButton.innerHTML = App.icons.get('paste');
            pasteButton.appendChild(el('span', { class: 'font-arrow', 'aria-hidden': 'true' }, ['▾']));
            document.body.appendChild(pasteButton);
        }
        const doc = App.deck.getDocument();
        const selection = doc && doc.getSelection();
        if (!App.text.pasteOptions() || !selection || selection.rangeCount === 0) {
            pasteButton.hidden = true;
            if (menu && menu.classList.contains('paste-options-menu')) {
                closeMenu();
            }
            return;
        }
        // The deck iframe shows the slide at 1:1: the cursor's box is in slide pixels.
        const range = selection.getRangeAt(0);
        const box = range.getClientRects()[0] || range.startContainer.parentElement.getBoundingClientRect();
        const overlay = document.getElementById('overlay').getBoundingClientRect();
        const zoom = App.canvas.getZoom();
        pasteButton.style.left = (overlay.left + box.right * zoom + 4) + 'px';
        pasteButton.style.top = (overlay.top + box.bottom * zoom + 2) + 'px';
        pasteButton.hidden = false;
    }

    App.textControls.init = function init() {
        ['text-pasted', 'history-changed', 'text-selection-changed', 'text-edit-changed', 'zoom-changed', 'slide-changed']
            .forEach((name) => App.events.on(name, refreshPasteButton));
    };

    /* The control named in the ribbon's layout. */
    App.textControls.create = function create(name) {
        if (name === 'lineSpacing') {
            return createLineSpacing();
        }
        if (name === 'fontColor') {
            return createColorButton('color');
        }
        if (name === 'highlight') {
            return createColorButton('background-color');
        }
        return name === 'fontFamily' ? createFontFamily() : createFontSize();
    };

    /* Show the selection's font and size; grey out when there is no text to format. */
    App.textControls.refresh = function refresh() {
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
        if (lineSpacingButton) {
            lineSpacingButton.disabled = !enabled;
        }
        Object.keys(colorButtons).forEach((property) => {
            const parts = colorButtons[property];
            parts.main.disabled = !enabled;
            parts.arrow.disabled = !enabled;
            parts.bar.style.background = shownColor(App.textControls.currentColor(property));
        });
    };
})();
