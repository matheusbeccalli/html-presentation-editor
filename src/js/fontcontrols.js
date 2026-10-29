/*
 * fontcontrols.js - the font list and the font size box of Home > Font (SPEC Phase 3).
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
 *
 * Talks to: commands.js (setFontFamily, setFontSize), text.js (what the
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

    /* The control named in the ribbon's layout ('fontFamily' or 'fontSize'). */
    App.fontControls.create = function create(name) {
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
    };
})();
