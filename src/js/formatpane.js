/*
 * formatpane.js - the Format pane on the right (SPEC 4, Phase 2: "Size & position").
 *
 * Shows X, Y, Width and Height of the selected element in px. Typing a value
 * and pressing Enter or Tab (or clicking elsewhere) applies it as one undo
 * step; Esc puts the old value back. Arrow keys in a field step 1 px, Shift
 * 10 px, like PowerPoint's spinner fields. Later phases add their own
 * sections here (text, table, image, chart options).
 *
 * Text boxes also get "Text box" options: Autofit (do not autofit / shrink
 * text on overflow / resize shape to fit text), as in PowerPoint's Text
 * Options.
 *
 * Talks to: selection.js (what is selected), transform.js, history.js, text.js (autofit),
 *           events (selection-changed, selection-dragged, history-changed).
 */

(function () {
    'use strict';

    App.formatPane = {};

    const TYPE_LABELS = {
        text: 'Text box', image: 'Picture', table: 'Table', shape: 'Shape', chart: 'Chart', group: 'Group',
    };

    // ---------------------------------------------------------------
    // Pure helpers (tested in tests/unit/formatpane.test.js)
    // ---------------------------------------------------------------

    /*
     * Read a number typed by the user: "120", "12.5", "12,5" (decimal comma,
     * as typed in Brazil) or "120 px". Rounded to 2 decimals. null if it is
     * not a number.
     */
    App.formatPane.parseNumber = function parseNumber(text) {
        const cleaned = String(text).trim().replace(/\s*px$/i, '').replace(',', '.');
        if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
            return null;
        }
        return App.util.round2(parseFloat(cleaned));
    };

    /* A copy of rect with one field changed; width/height stay at least MIN_SIZE. */
    App.formatPane.withField = function withField(rect, field, value) {
        const result = Object.assign({}, rect);
        const isSize = field === 'width' || field === 'height';
        result[field] = isSize ? Math.max(App.transform.MIN_SIZE, value) : value;
        return result;
    };

    // ---------------------------------------------------------------
    // The pane
    // ---------------------------------------------------------------

    let hint = null;
    let HINT = '';   // the hint's own text from index.html (nothing selected)
    let section = null;
    let typeLabel = null;
    let inputs = [];
    let textSection = null;
    let autofitHint = null;
    const edited = new Set();   // fields the user is typing in, not applied yet

    App.formatPane.init = function init() {
        hint = document.getElementById('format-hint');
        HINT = hint.textContent;
        section = document.getElementById('format-size');
        typeLabel = document.getElementById('format-type');
        inputs = Array.from(section.querySelectorAll('input[data-field]'));

        inputs.forEach((input) => {
            input.addEventListener('input', () => edited.add(input));
            input.addEventListener('change', () => apply(input));   // fires on Tab / click elsewhere
            input.addEventListener('keydown', (event) => onFieldKey(event, input));
        });

        textSection = document.getElementById('format-text');
        autofitHint = document.getElementById('format-autofit-hint');
        textSection.querySelectorAll('input[name="autofit"]').forEach((radio) => {
            radio.addEventListener('change', () => setAutofit(radio.value));
        });

        ['selection-changed', 'history-changed', 'slide-changed', 'deck-loaded', 'text-edit-changed'].forEach((name) => {
            App.events.on(name, () => App.formatPane.refresh());
        });
        App.events.on('selection-dragged', () => App.formatPane.refresh());
    };

    /* Show the selected element's values (fields being typed in are left alone). */
    App.formatPane.refresh = function refresh() {
        const element = App.selection.getElement();
        hint.hidden = !!element;
        // Several selected (Phase 7): no fields, just how many.
        const count = App.selection.count();
        hint.textContent = count > 1 ? count + ' objects selected' : HINT;
        section.hidden = !element;
        const isText = !!element && element.getAttribute('data-type') === 'text';
        textSection.hidden = !isText;
        if (!element) {
            edited.clear();
            return;
        }
        if (isText) {
            const mode = App.text.autofitOf(element);
            textSection.querySelectorAll('input[name="autofit"]').forEach((radio) => { radio.checked = radio.value === mode; });
            const scale = parseFloat(element.style.getPropertyValue('--autofit-scale'));
            autofitHint.textContent = mode === 'shrink' && scale < 1 ? 'Text shrunk to ' + Math.round(scale * 100) + '%' : '';
        }
        typeLabel.textContent = TYPE_LABELS[element.getAttribute('data-type')] || 'Object';
        const rect = App.transform.readRect(element);
        inputs.forEach((input) => {
            if (!edited.has(input)) {
                input.value = String(App.util.round2(rect[input.getAttribute('data-field')]));
            }
        });
    };

    function revert(input) {
        edited.delete(input);
        App.formatPane.refresh();
    }

    /* Apply the typed value of one field as one undo step. */
    function apply(input) {
        const element = App.selection.getElement();
        const value = App.formatPane.parseNumber(input.value);
        edited.delete(input);
        if (!element || value === null) {
            App.formatPane.refresh();   // not a number: show the old value again
            return;
        }
        const field = input.getAttribute('data-field');
        const rect = App.transform.readRect(element);
        const next = App.formatPane.withField(rect, field, value);
        if (next[field] === rect[field]) {
            App.formatPane.refresh();
            return;
        }
        const label = (field === 'left' || field === 'top') ? 'Move' : 'Resize';
        const scope = { slideId: App.deck.getCurrentSlide().getAttribute('data-slide-id') };
        App.history.change(label, scope, () => {
            App.transform.writeRect(element, next);
            App.text.fitText(element);   // autofit follows a new size
            App.tables.fitTable(element, { resized: true });   // so do a table's columns and rows
            App.shapes.render(element);   // and a shape's drawing
            App.charts.redraw(element);   // and a chart
        });
        // history-changed redraws the selection box and this pane.
    }

    /* Autofit chosen in the pane: one undo step (text.js does the fitting). */
    function setAutofit(mode) {
        const element = App.selection.getElement();
        const action = element && App.text.autofitAction(element, mode);
        if (!action) {
            return;
        }
        App.text.exitEdit({ select: false });
        App.history.change(action.label, { slideId: element.closest('section.slide').getAttribute('data-slide-id') }, action.run);
        App.selection.select(element);
    }

    function onFieldKey(event, input) {
        if (event.key === 'Enter') {
            event.preventDefault();
            apply(input);
            input.select();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            revert(input);
            input.blur();
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const current = App.formatPane.parseNumber(input.value);
            if (current === null) {
                return;
            }
            const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
            input.value = String(App.util.round2(current + step));
            apply(input);
        }
    }
})();
