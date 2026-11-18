/*
 * theme.js - the theme editor (SPEC Phase 7): the deck's colours and fonts,
 * the CSS variables in :root (--color-primary, --font-heading …), changed in
 * one place with a live preview (Design > Edit Theme), or copied from another
 * deck together with its slide master (Design > Copy Theme from Deck…).
 *
 * A new value goes where the deck's own CSS declares it (the last :root
 * declaration of that variable; only the value's text changes), so the deck
 * stays one stylesheet that can still be edited by hand in VS Code or by
 * Copilot. A variable the deck never declares goes in a :root rule of its own,
 *
 *   <style data-deck-theme>:root { --color-extra: #0070C0; }</style>
 *
 * after the deck's own CSS and before the editor's generated stylesheets.
 * Opening a deck folds an older data-deck-theme block back in (fold). Only
 * what uses the variables follows: a colour typed on an element stays.
 *
 * While the panel is open the slide shows the new values from a
 * <style data-editor-only> (never saved, even by an autosave meanwhile);
 * Apply writes data-deck-theme as one undo step ('Theme', the whole deck),
 * refitting text, tables and charts on every slide when a font changed.
 * Cancel or Esc leave the deck exactly as it was.
 *
 * Another deck is untrusted: its :root values are read from its stylesheet
 * text (it is never shown), and only plain colours and font lists come
 * through (safeValue); its master's logo only as a data:image.
 *
 * The pure helpers at the top are tested in tests/unit/theme.test.js.
 *
 * Talks to: master.js (the copied master, the own-footers question), text.js (theme cache, refit),
 *           tables.js, charts.js, deck.js, history.js, dialogs.js, importer.js (parseHtml).
 */

(function () {
    'use strict';

    App.theme = {};

    const STANDARD = ['--font-heading', '--font-body', '--color-primary', '--color-accent', '--color-text', '--color-bg'];
    const THEME_NAME = /^--(font-(heading|body)|color-[a-z0-9-]+)$/;
    const LABELS = { '--font-heading': 'Headings', '--font-body': 'Body', '--color-bg': 'Background' };

    // Windows fonts (the company's machines), each with fallbacks.
    App.theme.FONTS = [
        ['Calibri', 'Calibri, Arial, sans-serif'],
        ['Aptos', 'Aptos, Calibri, Arial, sans-serif'],
        ['Arial', 'Arial, sans-serif'],
        ['Segoe UI', '"Segoe UI", Arial, sans-serif'],
        ['Verdana', 'Verdana, sans-serif'],
        ['Tahoma', 'Tahoma, sans-serif'],
        ['Trebuchet MS', '"Trebuchet MS", sans-serif'],
        ['Georgia', 'Georgia, serif'],
        ['Cambria', 'Cambria, Georgia, serif'],
        ['Garamond', 'Garamond, Georgia, serif'],
        ['Times New Roman', '"Times New Roman", serif'],
    ];

    // ---------------------------------------------------------------
    // Pure helpers
    // ---------------------------------------------------------------

    /* '--color-primary' → 'Primary', '--color-accent-2' → 'Accent 2', '--font-heading' → 'Headings'. */
    App.theme.labelOf = function labelOf(name) {
        if (LABELS[name]) {
            return LABELS[name];
        }
        const words = name.replace(/^--(color|font)-/, '').split('-').join(' ');
        return words.charAt(0).toUpperCase() + words.slice(1);
    };

    /* The variables the panel shows: the standard fonts and colours first, then the deck's other colours. */
    App.theme.namesOf = function namesOf(found) {
        return STANDARD.concat(found.filter((name) => STANDARD.indexOf(name) === -1 && THEME_NAME.test(name)));
    };

    /*
     * The custom properties of the :root rules in stylesheet texts, in order
     * (a later one wins), with var(--x) resolved from the same set. Read from
     * the text, so another deck never has to be shown.
     */
    App.theme.rootValues = function rootValues(cssTexts) {
        const values = {};
        cssTexts.forEach((css) => {
            const text = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
            const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
            let rule;
            while ((rule = ruleRe.exec(text)) !== null) {
                const selectors = rule[1].split(',').map((part) => part.trim());
                if (selectors.indexOf(':root') === -1) {
                    continue;
                }
                rule[2].split(';').forEach((declaration) => {
                    const colon = declaration.indexOf(':');
                    const name = declaration.slice(0, colon).trim();
                    if (colon > 0 && name.indexOf('--') === 0) {
                        values[name] = declaration.slice(colon + 1).trim();
                    }
                });
            }
        });
        const varRe = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g;
        for (let pass = 0; pass < 5; pass += 1) {
            Object.keys(values).forEach((name) => {
                values[name] = values[name].replace(varRe, (match, other, fallback) =>
                    (other in values && other !== name ? values[other] : (fallback !== undefined ? fallback.trim() : match)));
            });
        }
        return values;
    };

    const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/deg+-]+\)|[a-z]+)$/i;
    const FONT_RE = /^[\w\s"',.-]+$/;

    /* A value that may go into our stylesheet: a plain colour, or a list of font names. Nothing else. */
    App.theme.safeValue = function safeValue(name, value) {
        const text = String(value || '').trim();
        if (!text || /url\(|var\(|[;{}<>\\@]|expression/i.test(text)) {
            return false;
        }
        return name.indexOf('--font-') === 0 ? FONT_RE.test(text) : COLOR_RE.test(text);
    };

    /* 'rgb(204, 9, 47)' → '#cc092f' (a colour picker wants #rrggbb); null if it is not rgb(). */
    App.theme.toHex = function toHex(rgb) {
        const match = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(String(rgb));
        if (!match) {
            return null;
        }
        return '#' + match.slice(1, 4).map((part) => Math.min(255, parseInt(part, 10)).toString(16).padStart(2, '0')).join('');
    };

    /* ':root { --a: 1; --b: 2; }' (an empty string for no values). */
    App.theme.css = function css(values) {
        const names = Object.keys(values);
        return names.length ? ':root { ' + names.map((name) => name + ': ' + values[name] + ';').join(' ') + ' }\n' : '';
    };

    // ---------------------------------------------------------------
    // The deck (DOM, no page state)
    // ---------------------------------------------------------------

    const EDITOR_STYLES = 'style[data-deck-table], style[data-deck-groups], style[data-deck-master], style[data-deck-text]';
    App.theme.EDITOR_STYLES = EDITOR_STYLES;   // background.js puts its rule before them too

    /* The values in the deck's <style data-deck-theme> ({} when it has none). */
    App.theme.readOverride = function readOverride(doc) {
        const style = doc.head.querySelector('style[data-deck-theme]');
        return style ? App.theme.rootValues([style.textContent]) : {};
    };

    /* Put `values` in the deck's <style data-deck-theme>, after its own CSS and before the editor's; none when empty. */
    App.theme.write = function write(doc, values) {
        doc.head.querySelectorAll('style[data-deck-theme]').forEach((old) => old.remove());
        const text = App.theme.css(values);
        if (!text) {
            return;
        }
        const style = doc.createElement('style');
        style.setAttribute('data-deck-theme', '');
        style.textContent = text;
        doc.head.insertBefore(style, doc.head.querySelector(EDITOR_STYLES));
    };

    /* The deck's own stylesheets: not the editor's (data-deck-…) and not its editing-only ones. */
    function ownStyles(doc) {
        return Array.from(doc.head.querySelectorAll('style')).filter((style) => !Array.from(style.attributes)
            .some((attribute) => attribute.name.indexOf('data-deck-') === 0 || attribute.name === 'data-editor-only'));
    }

    /*
     * Where `name` is declared in a :root rule of stylesheet text `css` (the
     * last such declaration, the one that wins): { start, end } of its value,
     * or null. Comments are skipped, so a commented-out rule is never changed.
     */
    App.theme.declarationIn = function declarationIn(css, name) {
        const blank = String(css).replace(/\/\*[\s\S]*?\*\//g, (comment) => ' '.repeat(comment.length));
        const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
        const declarationRe = new RegExp('(^|[;\\s])' + name + '\\s*:', 'g');
        let found = null;
        let rule;
        while ((rule = ruleRe.exec(blank)) !== null) {
            if (rule[1].split(',').map((part) => part.trim()).indexOf(':root') === -1) {
                continue;
            }
            const bodyStart = rule.index + rule[1].length + 1;
            const body = rule[2];
            declarationRe.lastIndex = 0;
            let match;
            while ((match = declarationRe.exec(body)) !== null) {
                let start = match.index + match[0].length;
                let end = body.indexOf(';', start);
                end = end === -1 ? body.length : end;
                while (start < end && /\s/.test(body[start])) {
                    start += 1;
                }
                while (end > start && /\s/.test(body[end - 1])) {
                    end -= 1;
                }
                found = { start: bodyStart + start, end: bodyStart + end };
            }
        }
        return found;
    };

    /*
     * Theme values into the deck: each one where the deck's own CSS declares it
     * (only that value's text changes, so a later hand edit there still works);
     * what the deck never declares goes in <style data-deck-theme>.
     */
    App.theme.applyValues = function applyValues(doc, values) {
        const override = App.theme.readOverride(doc);
        Object.keys(values).forEach((name) => {
            let target = null;
            ownStyles(doc).forEach((style) => {
                const at = App.theme.declarationIn(style.textContent, name);
                if (at) {
                    target = { style: style, at: at };
                }
            });
            if (target) {
                const text = target.style.textContent;
                target.style.textContent = text.slice(0, target.at.start) + values[name] + text.slice(target.at.end);
                delete override[name];   // or it would still win over the deck's own
            } else {
                override[name] = values[name];
            }
        });
        App.theme.write(doc, override);
    };

    /* On open: a data-deck-theme block (saved by an earlier version) moved into the deck's own :root where it can. */
    App.theme.fold = function fold(doc) {
        const values = App.theme.readOverride(doc);
        doc.head.querySelectorAll('style[data-deck-theme]').forEach((old) => old.remove());
        App.theme.applyValues(doc, values);
    };

    const DATA_LOGO = /^data:image\/[a-z0-9+.-]+;base64,[a-z0-9+/=\s]+$/i;

    /* Another deck's theme from its HTML text: { values (safe ones only), master (its slide master's settings, or null) }. */
    App.theme.fromDeckText = function fromDeckText(html) {
        const doc = App.importer.parseHtml(html);
        const css = Array.from(doc.querySelectorAll('style'))
            .filter((style) => !style.hasAttribute('data-deck-player')).map((style) => style.textContent);
        const all = App.theme.rootValues(css);
        const values = {};
        Object.keys(all).forEach((name) => {
            if (THEME_NAME.test(name) && App.theme.safeValue(name, all[name])) {
                values[name] = all[name];
            }
        });
        let master = doc.head && doc.body ? App.master.read(doc) : null;
        if (master && !App.master.layout(master).length) {
            master = null;
        }
        if (master && master.logo && !DATA_LOGO.test(master.logo.src)) {
            master.logo = null;   // a picture from elsewhere would load when the saved deck is opened
        }
        return { values: values, master: master };
    };

    // ---------------------------------------------------------------
    // In the editor
    // ---------------------------------------------------------------

    App.theme.init = function init() {
        // text.js remembers each document's theme colours; after a theme change (or its undo) they are new.
        ['history-changed', 'deck-loaded'].forEach((name) => App.events.on(name, () => {
            const doc = App.deck.getDocument();
            if (doc) {
                App.text.forgetTheme(doc);
            }
        }));
    };

    App.theme.canEdit = function canEdit() {
        return App.state.hasDeck && !!App.deck.getDocument();
    };

    /* A theme value as the deck resolves it now (the preview included). */
    function valueOf(doc, name) {
        return doc.defaultView.getComputedStyle(doc.documentElement).getPropertyValue(name).trim();
    }

    /* Any colour as #rrggbb, via the deck (named colours, #fff, var() …). */
    function hexOf(doc, value) {
        const probe = doc.createElement('span');
        probe.setAttribute('data-editor-only', '');
        probe.style.color = value;
        doc.body.appendChild(probe);
        const hex = App.theme.toHex(doc.defaultView.getComputedStyle(probe).color);
        probe.remove();
        return hex || '#000000';
    }
    App.theme.hexOf = hexOf;   // background.js: Apply to All writes a plain colour

    /* Every slide's text, tables and charts measured again with the new fonts (inside the Theme step). */
    function refitAll(doc) {
        doc.querySelectorAll('section.slide').forEach((slide) => {
            App.deck.withSlideShown(slide, () => {
                slide.querySelectorAll('.el').forEach((element) => {
                    App.text.fitText(element);
                    App.tables.fitTable(element);
                    App.charts.redraw(element);
                });
            });
        });
    }

    /*
     * The theme panel, beside the slide (the slide stays visible: the preview).
     * options.copy: open the file chooser for Copy Theme from Deck… straight away.
     */
    App.theme.open = async function open(options) {
        if (!App.theme.canEdit()) {
            return;
        }
        App.text.exitEdit({ select: true });
        const doc = App.deck.getDocument();
        const el = App.util.el;
        const names = App.theme.namesOf(App.text.themeColorNames(doc));
        const before = {};
        names.forEach((name) => { before[name] = valueOf(doc, name); });
        const touched = {};      // name → new value
        let copiedMaster = null;
        let pending = null;      // reading another deck

        const preview = doc.createElement('style');
        preview.setAttribute('data-editor-only', '');
        preview.setAttribute('data-theme-preview', '');
        doc.head.appendChild(preview);
        const showPreview = () => { preview.textContent = App.theme.css(touched); };

        const idOf = (name) => 'theme-' + name.slice(2);
        const fields = {};      // name → { set(value) }
        const rows = names.map((name) => {
            const label = el('label', { for: idOf(name) }, [App.theme.labelOf(name)]);
            if (name.indexOf('--font-') === 0) {
                const select = el('select', { id: idOf(name) });
                const known = App.theme.FONTS.some((font) => font[1] === before[name]);
                const options = (known || !before[name] ? [] : [[before[name].split(',')[0].replace(/["']/g, '') + ' (now)', before[name]]])
                    .concat(App.theme.FONTS);
                options.forEach((font) => select.appendChild(el('option', { value: font[1] }, [font[0]])));
                select.value = before[name];
                select.addEventListener('change', () => { touched[name] = select.value; showPreview(); });
                fields[name] = { set: (value) => {
                    if (!Array.from(select.options).some((option) => option.value === value)) {
                        select.appendChild(el('option', { value: value }, [value.split(',')[0].replace(/["']/g, '')]));
                    }
                    select.value = value;
                } };
                return el('div', { class: 'theme-row' }, [label, select]);
            }
            const picker = el('input', { id: idOf(name), type: 'color', value: hexOf(doc, before[name] || '#000000') });
            const text = el('input', { id: idOf(name) + '-hex', type: 'text', autocomplete: 'off', value: before[name],
                'aria-label': App.theme.labelOf(name) + ' colour' });
            picker.addEventListener('input', () => { text.value = picker.value; touched[name] = picker.value; showPreview(); });
            const typed = () => {
                if (App.theme.safeValue(name, text.value) && text.value.trim() !== before[name]) {
                    touched[name] = text.value.trim();
                    picker.value = hexOf(doc, touched[name]);
                    showPreview();
                }
            };
            text.addEventListener('change', typed);
            text.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    typed();
                }
            });
            fields[name] = { set: (value) => { text.value = value; picker.value = hexOf(doc, value); } };
            const row = [label, picker, text];
            if (App.textControls.canPickScreenColor()) {
                // Eyedropper (Phase 10): a colour from anywhere on the screen, e.g. the client's logo.
                const dropper = el('button', { type: 'button', class: 'btn theme-eyedropper', 'data-for': name,
                    title: 'Eyedropper: pick ' + App.theme.labelOf(name) + ' anywhere on the screen (Esc cancels)',
                    'aria-label': 'Eyedropper for ' + App.theme.labelOf(name) });
                dropper.innerHTML = App.icons.get('eyedropper');
                dropper.addEventListener('click', () => App.textControls.pickScreenColor().then((color) => {
                    if (color) {
                        text.value = color;
                        picker.value = color;
                        touched[name] = color;
                        showPreview();
                    }
                }));
                row.push(dropper);
            }
            return el('div', { class: 'theme-row' }, row);
        });

        const note = el('p', { class: 'panel-hint theme-copy-note' });
        const file = el('input', { id: 'theme-copy-file', type: 'file', accept: '.html,.htm,text/html', hidden: true });
        file.addEventListener('change', () => {
            const picked = file.files && file.files[0];
            if (!picked) {
                return;
            }
            pending = picked.text().then((html) => {
                const theme = App.theme.fromDeckText(html);
                Object.keys(theme.values).forEach((name) => {
                    if (fields[name]) {
                        touched[name] = theme.values[name];
                        fields[name].set(theme.values[name]);
                    }
                });
                copiedMaster = theme.master;
                showPreview();
                note.textContent = 'From ' + picked.name + ': ' + Object.keys(theme.values).filter((name) => fields[name]).length +
                    ' colours and fonts. ' + (copiedMaster ? 'Its slide master (logo, footer, numbers) comes too.' : 'It has no slide master: yours stays.');
            });
        });
        const copy = el('button', { type: 'button', class: 'btn', onclick: () => file.click() }, ['Copy from another deck…']);
        const body = el('div', { class: 'theme-form' }, [
            el('p', { class: 'panel-hint' }, ['The slide shows each change at once. Only what uses the theme follows; ' +
                'a colour set on one element stays.']),
        ].concat(rows, [el('div', { class: 'theme-row' }, [copy, file]), note]));

        const shown = App.dialogs.show({ title: 'Theme', body: body, side: true, buttons: [
            { label: 'Cancel', value: null }, { label: 'Apply', value: true, primary: true }] });
        if (options && options.copy) {
            file.click();
        }
        const choice = await shown;
        if (pending) {
            await pending.catch(() => null);
        }
        preview.remove();   // the deck exactly as it was; Apply writes the change as one step
        if (choice !== true) {
            return;
        }
        const changed = {};
        Object.keys(touched).forEach((name) => {
            if (touched[name] !== before[name]) {
                changed[name] = touched[name];
            }
        });
        if (!Object.keys(changed).length && !copiedMaster) {
            return;
        }
        let own = null;
        if (copiedMaster) {
            own = await App.master.askOwn(doc, copiedMaster);
            if (!own) {
                return;   // Cancel in the question: nothing changes
            }
        }
        const fontsChanged = Object.keys(changed).some((name) => name.indexOf('--font-') === 0);
        App.history.change('Theme', 'deck', () => {
            App.theme.applyValues(doc, changed);
            if (copiedMaster) {
                App.master.applyInStep(doc, copiedMaster, own);
            }
            App.text.forgetTheme(doc);
            if (fontsChanged) {
                refitAll(doc);
            }
        });
    };
})();
