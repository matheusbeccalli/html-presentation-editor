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

    /* A colour chosen from the font colour / highlight list: it applies, and the button keeps it for next time. */
    function chooseColor(property, value) {
        if (value !== null) {
            lastColors[property] = value;
        }
        App.commands.run(property === 'color' ? 'setFontColor' : 'setHighlight', value);
    }

    function swatch(title, value, spec) {
        return el('button', {
            type: 'button', class: 'color-swatch', title: title, 'aria-label': title, style: 'background: ' + shownColor(value),
            onmousedown: (event) => event.preventDefault(),
            onclick: () => {
                closeMenu();
                choose(spec, value);
            },
        });
    }

    function choose(spec, value) {
        spec.choose(value);
        App.ribbon.refresh();
    }

    /* The colours of a split button's arrow: its extra items, the theme's or highlight colours, "More colors…". */
    function openColorMenu(anchor, spec) {
        const list = el('div', { class: 'menu color-menu ' + spec.menuClass, role: 'menu' });
        const section = (label, colors) => {
            list.append(el('div', { class: 'color-menu-label' }, [label]),
                el('div', { class: 'color-grid' }, colors.map(([title, value]) => swatch(title, value, spec))));
        };
        (spec.extras || []).forEach(([label, value]) => list.appendChild(el('button', {
            type: 'button', class: 'menu-item', title: label, onmousedown: (event) => event.preventDefault(),
            onclick: () => {
                closeMenu();
                choose(spec, value);
            },
        }, [el('span', { class: 'menu-label' }, [label])])));
        if (spec.palette === 'highlight') {
            section('Highlight colors', HIGHLIGHT_COLORS);
        } else {
            const doc = App.deck.getDocument();
            const theme = !doc ? [] : spec.themeNames ? spec.themeNames(doc) : App.text.themeColorNames(doc);
            if (theme.length > 0) {
                section('Theme colors', theme.map((name) => [themeColorTitle(name), 'var(' + name + ')']));
            }
            section('Standard colors', STANDARD_COLORS);
        }
        // Any colour: the browser's colour window (it takes the focus; the text gets it back after).
        const picker = el('input', { type: 'color', class: 'color-picker-input', tabindex: '-1' });
        picker.addEventListener('change', () => {
            choose(spec, picker.value);
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
        if (App.textControls.canPickScreenColor()) {
            list.appendChild(el('button', {
                type: 'button', class: 'menu-item', title: 'Pick a colour anywhere on the screen (Esc cancels)',
                onmousedown: (event) => event.preventDefault(),
                onclick: () => {
                    closeMenu();
                    App.textControls.pickScreenColor().then((color) => {
                        if (color) {
                            choose(spec, color);
                        }
                        App.text.refocus();
                    });
                },
            }, [el('span', { class: 'menu-label' }, ['Eyedropper'])]));
        }
        showMenu(anchor, list);
    }

    /*
     * Eyedropper (Phase 10): the browser's own EyeDropper (Edge and Chrome; no
     * library) lets the user click any pixel on the screen, a logo in another
     * window too. It needs a click to start it; Esc cancels (null).
     */
    App.textControls.canPickScreenColor = function canPickScreenColor() {
        return typeof window.EyeDropper === 'function';
    };

    /* The colour picked on the screen as '#rrggbb', or null (cancelled or not available). */
    App.textControls.pickScreenColor = function pickScreenColor() {
        if (!App.textControls.canPickScreenColor()) {
            return Promise.resolve(null);
        }
        return new window.EyeDropper().open().then((result) => (result && result.sRGBHex ? result.sRGBHex.toLowerCase() : null),
            () => null);
    }

    const colorButtons = [];   // [{ main, arrow, bar, spec }]

    /*
     * A colour split button (tabledesign.js uses it too). spec: { label, icon,
     * command: what the main part runs, applying the colour on its bar (none:
     * the main part opens the list too), menuClass, palette: 'theme' (theme and
     * standard colours) | 'highlight', extras: [[label, value]] listed first
     * (e.g. "No color"), current(): the colour on the bar, choose(value),
     * isEnabled(), themeNames(doc): the theme colours listed (default: text.themeColorNames) }.
     */
    App.textControls.colorSplit = function colorSplit(spec) {
        const open = () => (menu && menu.classList.contains(spec.menuClass) ? closeMenu() : openColorMenu(main, spec));
        const main = keepEdit(el('button', {
            type: 'button', class: 'ribbon-button small color-main', 'data-command': spec.command || null,
            title: spec.label, 'aria-label': spec.label, 'aria-haspopup': spec.command ? null : 'menu',
            onmousedown: (event) => event.preventDefault(),
            onclick: () => (spec.command ? App.commands.run(spec.command) : open()),
        }));
        main.innerHTML = App.icons.get(spec.icon);
        const bar = el('span', { class: 'color-bar' });
        main.appendChild(bar);
        const arrow = keepEdit(el('button', {
            type: 'button', class: 'color-menu-button ' + spec.menuClass + '-button',
            title: spec.label + ': more colors', 'aria-haspopup': 'menu',
            onmousedown: (event) => event.preventDefault(),
            onclick: open,
        }, ['▾']));
        colorButtons.push({ main: main, arrow: arrow, bar: bar, spec: spec });
        return el('div', { class: 'color-split' }, [main, arrow]);
    };

    function createColorButton(property) {
        const command = property === 'color' ? 'fontColor' : 'highlight';
        return App.textControls.colorSplit({
            label: App.commands.label(command), icon: command, command: command,
            menuClass: property === 'color' ? 'font-color-menu' : 'highlight-menu',
            palette: property === 'color' ? 'theme' : 'highlight',
            extras: property === 'color' ? [] : [['No color', null]],
            current: () => App.textControls.currentColor(property),
            choose: (value) => chooseColor(property, value),
            isEnabled: () => App.commands.isEnabled('setFontFamily'),
        });
    }

    /* What a stored colour looks like on screen (for tabledesign.js's buttons too). */
    App.textControls.shownColor = shownColor;

    /* A list under `anchor` (tabledesign.js uses it too): items [{ label, value, checked?, style? }] -> onChoose(value). */
    App.textControls.openMenu = function (anchor, className, items, onChoose) {
        return openMenu(anchor, className, items, onChoose);
    };

    App.textControls.isMenuOpen = function isMenuOpen(className) {
        return !!menu && menu.classList.contains(className);
    };

    App.textControls.closeMenu = closeMenu;

    /* Open the colour menu of the split button with `menuClass` on the tab shown (a right-click item: background.js). */
    App.textControls.openColorMenuFor = function openColorMenuFor(menuClass) {
        const parts = colorButtons.find((one) => one.spec.menuClass === menuClass && one.main.isConnected);
        if (parts && !parts.main.disabled) {
            openColorMenu(parts.main, parts.spec);
        }
    };

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

    // ---- Change Case (Aa ▾) and Align Text (Phase 10) ----

    let caseButton = null;
    let alignTextButton = null;
    const CASE_ITEMS = [['sentence', 'Sentence case.'], ['lower', 'lowercase'], ['upper', 'UPPERCASE'],
        ['title', 'Capitalize Each Word'], ['toggle', 'tOGGLE cASE']];
    const ANCHOR_ITEMS = [['top', 'Top', 'alignTextTop'], ['middle', 'Middle', 'alignTextMiddle'], ['bottom', 'Bottom', 'alignTextBottom']];

    /* A small ribbon button with an icon and ▾ that opens a list (a menu control). */
    function menuButton(className, title, label, icon, menuClass, open) {
        const button = keepEdit(el('button', {
            type: 'button', class: 'ribbon-button small ' + className, title: title, 'aria-label': label, 'aria-haspopup': 'menu',
            onmousedown: (event) => event.preventDefault(),
            onclick: () => (menu && menu.classList.contains(menuClass) ? closeMenu() : open()),
        }));
        button.innerHTML = App.icons.get(icon);
        button.appendChild(el('span', { class: 'font-arrow', 'aria-hidden': 'true' }, ['▾']));
        return button;
    }

    function createChangeCase() {
        caseButton = menuButton('change-case-button', 'Change Case (Shift+F3: lowercase, UPPERCASE, Capitalize Each Word)',
            'Change Case', 'changeCase', 'change-case-menu', () => {
                openMenu(caseButton, 'change-case-menu', CASE_ITEMS.map(([value, label]) => ({ label: label, value: value })),
                    (value) => App.commands.run('changeCase', value).then(() => App.text.refocus()));
            });
        return caseButton;
    }

    function createAlignText() {
        alignTextButton = menuButton('align-text-button', 'Align Text: top, middle or bottom of the box', 'Align Text',
            'alignTextMiddle', 'align-text-menu', () => {
                const state = App.text.layoutState();
                openMenu(alignTextButton, 'align-text-menu', ANCHOR_ITEMS.map(([value, label]) => ({
                    label: label, value: value, checked: !!state && state.anchor === value,
                })), (value) => App.commands.run(ANCHOR_ITEMS.find((item) => item[0] === value)[2]).then(() => App.text.refocus()));
            });
        return alignTextButton;
    }

    // ---- Review > Language (Phase 10) ----

    let languageButton = null;

    function languageLabel() {
        const doc = App.deck.getDocument();
        const lang = doc ? App.text.deckLanguage(doc) : 'pt-BR';
        return App.text.LANGUAGES.find(([code]) => code === lang)[1];
    }

    function createLanguage() {
        languageButton = el('button', {
            type: 'button', class: 'ribbon-button small named list-button language-button',
            title: 'The deck\'s language: PowerPoint checks the exported text in it', 'aria-haspopup': 'menu',
            onclick: () => {
                if (menu && menu.classList.contains('language-menu')) {
                    closeMenu();
                    return;
                }
                const doc = App.deck.getDocument();
                const current = doc ? App.text.deckLanguage(doc) : null;
                openMenu(languageButton, 'language-menu', App.text.LANGUAGES.map(([code, label]) => ({
                    label: label, value: code, checked: code === current,
                })), (value) => App.commands.run('setDeckLanguage', value));
            },
        }, ['Language ▾']);
        return languageButton;
    }

    /* Review > Spelling in Edge: why the red underlines follow Edge's settings, and where to change them. */
    App.textControls.openSpellingHelp = function openSpellingHelp() {
        const p = (text) => el('p', {}, [text]);
        App.dialogs.show({
            title: 'Spelling in Edge', className: 'dialog-spelling', buttons: [{ label: 'OK', value: true, primary: true }],
            body: el('div', {}, [
                p('Edge underlines spelling mistakes using the languages turned on in its own settings, the same for every ' +
                    'page; the deck\'s language (Review > Language) does not change that.'),
                p('To check Portuguese and English at the same time: open a new Edge tab, type edge://settings/languages in the ' +
                    'address bar, add Portuguese (Brazil) and English (United States) under Preferred languages if they are ' +
                    'missing, and turn both on under Check spelling. A word is then accepted if it is right in either language.'),
                p('On a work computer these settings may be locked by IT.'),
                p('The deck\'s language goes into Export > PowerPoint: PowerPoint checks the slides\' text in that language.'),
            ]),
        });
    };

    // ---- The paste options button (after a paste: at the end of the pasted text, or at a pasted table's corner) ----

    let pasteButton = null;

    /*
     * What the button offers now: { current, options, choose(mode), at: { x, y }
     * (slide px) }, for the last paste into text or the table just pasted (tablepaste.js); else null.
     */
    function pasteChoices() {
        const text = App.text.pasteOptions();
        const doc = App.deck.getDocument();
        const selection = doc && doc.getSelection();
        if (text && selection && selection.rangeCount > 0) {
            // The deck iframe shows the slide at 1:1: the cursor's box is in slide pixels.
            const range = selection.getRangeAt(0);
            const box = range.getClientRects()[0] || range.startContainer.parentElement.getBoundingClientRect();
            return Object.assign({ choose: App.text.repaste, at: { x: box.right, y: box.bottom } }, text);
        }
        const table = App.tablePaste.pasteOptions();
        if (table) {
            return Object.assign({ choose: App.tablePaste.repaste,
                at: { x: table.rect.left + table.rect.width, y: table.rect.top + table.rect.height } }, table);
        }
        return null;
    }

    function openPasteMenu() {
        const choices = pasteChoices();
        if (!choices) {
            return;
        }
        const items = choices.options.map((option) => ({ label: option.label, value: option.mode,
            checked: option.mode === choices.current }));
        openMenu(pasteButton, 'paste-options-menu', items, (mode) => choices.choose(mode));
    }

    /* Show the button where the paste ended while it can be switched; hide it otherwise. */
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
        const choices = pasteChoices();
        if (!choices) {
            pasteButton.hidden = true;
            if (menu && menu.classList.contains('paste-options-menu')) {
                closeMenu();
            }
            return;
        }
        const overlay = document.getElementById('overlay').getBoundingClientRect();
        const zoom = App.canvas.getZoom();
        pasteButton.style.left = (overlay.left + choices.at.x * zoom + 4) + 'px';
        pasteButton.style.top = (overlay.top + choices.at.y * zoom + 2) + 'px';
        pasteButton.hidden = false;
    }

    App.textControls.init = function init() {
        ['text-pasted', 'table-pasted', 'history-changed', 'text-selection-changed', 'text-edit-changed', 'zoom-changed',
            'slide-changed', 'selection-changed'].forEach((name) => App.events.on(name, refreshPasteButton));
    };

    /* The control named in the ribbon's layout. */
    App.textControls.create = function create(name) {
        if (name === 'lineSpacing') {
            return createLineSpacing();
        }
        if (name === 'changeCase') {
            return createChangeCase();
        }
        if (name === 'alignText') {
            return createAlignText();
        }
        if (name === 'deckLanguage') {
            return createLanguage();
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
    /* The colour split buttons on the tab shown: enabled or not, the colour on their bar. */
    function refreshColorButtons() {
        for (let i = colorButtons.length - 1; i >= 0; i--) {
            const parts = colorButtons[i];
            if (!parts.main.isConnected) {
                colorButtons.splice(i, 1);   // its tab is no longer shown
                continue;
            }
            const enabled = parts.spec.isEnabled();
            parts.main.disabled = !enabled;
            parts.arrow.disabled = !enabled;
            parts.bar.style.background = shownColor(parts.spec.current());
        }
    }

    /* The Phase 10 menu buttons, on whichever tab shows them. */
    function refreshMenuButtons() {
        if (caseButton) {
            caseButton.disabled = !App.commands.isEnabled('changeCase');
        }
        if (alignTextButton) {
            alignTextButton.disabled = !App.commands.isEnabled('alignTextMiddle');
        }
        if (languageButton && languageButton.isConnected) {
            languageButton.textContent = languageLabel() + ' ▾';
            languageButton.disabled = !App.commands.isEnabled('setDeckLanguage');
        }
    }

    App.textControls.refresh = function refresh() {
        refreshColorButtons();
        refreshMenuButtons();
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
    };
})();
