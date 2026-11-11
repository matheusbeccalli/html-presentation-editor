/*
 * master.js - the slide master (SPEC 3.3 and Phase 7): a logo, a footer text,
 * a "Confidencial" label and slide numbers on every slide, edited in one
 * place, a fill-in dialog (View > Slide Master, Insert > Header & Footer).
 *
 * The deck keeps them once, in a deck-level <div class="master"> after the
 * slides, which is never shown itself:
 *
 *   <div class="master" data-numbers="n/total" data-skip-title="true">
 *     <div class="master-item" data-master="logo" data-corner="top-right" style="left: 1112px; top: 24px; width: 120px; height: 40px;"></div>
 *     <div class="master-item" data-master="footer" style="left: 48px; top: 684px; width: 560px; height: 20px;">Projeto Atlas</div>
 *     <div class="master-item" data-master="label" style="…">Confidencial</div>
 *     <div class="master-item" data-master="number" style="…"></div>
 *   </div>
 *
 * The logo picture is in the deck's <style data-deck-master> (MASTER_CSS plus
 * one background-image rule), so its data: URI is in the file once, not
 * once per slide. Positions are fixed by role (layout).
 *
 * What shows on a slide is a copy: sync() puts a <div class="master-layer">
 * first in every slide (behind the slide's own elements), with the slide's
 * number written in ("3" or "3 / 15", hidden slides counted, as in
 * PowerPoint), and none on the title slide (the first slide, or any Title
 * Slide layout) when data-skip-title is set. The copies are derived: sync()
 * runs after every change, when a deck is shown and on save, writes only what
 * differs, and the importer drops them on open. They are not .el and carry no
 * data-id, so selecting, snapping, Ctrl+A, Find and the stacking order never
 * see them; thumbnails, the saved deck and its print do.
 *
 * A deck made elsewhere may type its own footer and numbers on each slide:
 * Apply then lists them (findOwn) and offers to remove them in the same step.
 *
 * Tested in tests/unit/master.test.js (no page state) and e2e test_slide_master(_own_footers).
 *
 * Talks to: history.js ('deck' step), deck.js, images.js (the logo file), dialogs.js, events.
 */

(function () {
    'use strict';

    App.master = {};

    const SLIDE = { width: 1280, height: 720 };
    const MARGIN = 48;          // from the left and right edges
    const LOGO_MARGIN = 24;     // from the top or bottom edge
    const LINE = { top: 684, height: 20 };   // the bottom line: footer, label, number
    const GAP = 16;             // between a bottom-corner logo and the text beside it
    const LOGO_HEIGHT = 40;
    const LOGO_MAX_WIDTH = 200;

    App.master.CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

    /* Nothing set (Don't show on the title slide is on by default: a cover rarely wants a number). */
    App.master.EMPTY = Object.freeze({ logo: null, footer: '', label: '', numbers: 'none', skipTitle: true });

    App.master.MASTER_CSS =
        '.master { display: none !important; }\n' +
        '.master-layer { position: absolute; left: 0; top: 0; width: 1280px; height: 720px; z-index: 0; pointer-events: none; }\n' +
        '.master-item { position: absolute; box-sizing: border-box; margin: 0; overflow: hidden; white-space: nowrap; ' +
        'text-overflow: ellipsis; font-family: var(--font-body, Calibri, Arial, sans-serif); font-size: 10pt; line-height: 20px; ' +
        'color: var(--color-text, #222); }\n' +
        '.master-item[data-master="label"] { text-align: center; font-weight: bold; color: var(--color-primary, #CC092F); }\n' +
        '.master-item[data-master="number"] { text-align: right; }\n' +
        '.master-item[data-master="logo"] { background: no-repeat center / contain; }\n';

    const hundredths = (value) => Math.round(value * 100) / 100;

    // ---------------------------------------------------------------
    // Pure helpers
    // ---------------------------------------------------------------

    /* A logo's box for a picture of naturalWidth x naturalHeight: 40 px high, at most 200 px wide. */
    App.master.logoSize = function logoSize(naturalWidth, naturalHeight) {
        let height = LOGO_HEIGHT;
        let width = naturalHeight ? LOGO_HEIGHT * naturalWidth / naturalHeight : LOGO_HEIGHT;
        if (width > LOGO_MAX_WIDTH) {
            height = LOGO_MAX_WIDTH * height / width;
            width = LOGO_MAX_WIDTH;
        }
        return { width: hundredths(width), height: hundredths(height) };
    };

    /* The number shown on the slide at `index` (from 0) of `total`: format 'n' gives "3", 'n/total' "3 / 15". */
    App.master.numberText = function numberText(index, total, format) {
        return format === 'n/total' ? (index + 1) + ' / ' + total : String(index + 1);
    };

    /*
     * Where each part goes: [{ role, rect, text }] for what `settings` asks for,
     * in the order logo, footer, label, number. The footer and the number make
     * room for a logo in their bottom corner.
     */
    App.master.layout = function layout(settings) {
        const items = [];
        const logo = settings.logo;
        let footerLeft = MARGIN;
        let numberLeft = SLIDE.width - MARGIN - 100;
        if (logo) {
            const right = logo.corner === 'top-right' || logo.corner === 'bottom-right';
            const bottom = logo.corner === 'bottom-left' || logo.corner === 'bottom-right';
            const rect = {
                left: right ? hundredths(SLIDE.width - MARGIN - logo.width) : MARGIN,
                top: bottom ? hundredths(SLIDE.height - LOGO_MARGIN - logo.height) : LOGO_MARGIN,
                width: logo.width, height: logo.height,
            };
            items.push({ role: 'logo', rect: rect, text: '' });
            if (bottom && !right) {
                footerLeft = hundredths(MARGIN + logo.width + GAP);
            } else if (bottom && right) {
                numberLeft = hundredths(numberLeft - logo.width - GAP);
            }
        }
        const line = (left, width) => ({ left: left, top: LINE.top, width: width, height: LINE.height });
        if (settings.footer) {
            items.push({ role: 'footer', rect: line(footerLeft, hundredths(MARGIN + 560 - footerLeft)), text: settings.footer });
        }
        if (settings.label) {
            items.push({ role: 'label', rect: line(540, 200), text: settings.label });
        }
        if (settings.numbers === 'n' || settings.numbers === 'n/total') {
            items.push({ role: 'number', rect: line(numberLeft, 100), text: '' });
        }
        return items;
    };

    /* The deck's master stylesheet, with the logo picture (a data: URI) when there is one. */
    App.master.css = function css(logoSrc) {
        return App.master.MASTER_CSS + (logoSrc
            ? '.master-item[data-master="logo"] { background-image: url("' + logoSrc + '"); }\n' : '');
    };

    // ---------------------------------------------------------------
    // The deck (DOM, no page state)
    // ---------------------------------------------------------------

    const LOGO_RE = /background-image:\s*url\("([^"]+)"\)/;

    function styleOf(doc) {
        let style = doc.head.querySelector('style[data-deck-master]');
        if (!style) {
            style = doc.createElement('style');
            style.setAttribute('data-deck-master', '');
            doc.head.appendChild(style);
        }
        return style;
    }

    function logoSrcOf(doc) {
        const style = doc.head && doc.head.querySelector('style[data-deck-master]');
        const match = style && LOGO_RE.exec(style.textContent);
        return match ? match[1] : null;
    }

    /* The master stylesheet as it should be now, keeping the deck's logo (the importer runs this on open). */
    App.master.refreshStyle = function refreshStyle(doc) {
        const src = logoSrcOf(doc);
        doc.head.querySelectorAll('style[data-deck-master]').forEach((old) => old.remove());
        styleOf(doc).textContent = App.master.css(src);
    };

    /* What the deck's master holds now, as the dialog shows it (EMPTY when it has none). */
    App.master.read = function read(doc) {
        const master = doc.querySelector('body > .master, .master');
        if (!master || !master.querySelector(':scope > .master-item[data-master]')) {
            return Object.assign({}, App.master.EMPTY);
        }
        const item = (role) => master.querySelector(':scope > .master-item[data-master="' + role + '"]');
        const logoItem = item('logo');
        const src = logoSrcOf(doc);
        return {
            logo: logoItem && src ? {
                src: src, corner: logoItem.getAttribute('data-corner') || 'top-right',
                width: parseFloat(logoItem.style.width), height: parseFloat(logoItem.style.height),
            } : null,
            footer: item('footer') ? item('footer').textContent : '',
            label: item('label') ? item('label').textContent : '',
            numbers: item('number') ? (master.getAttribute('data-numbers') || 'n') : 'none',
            skipTitle: master.getAttribute('data-skip-title') === 'true',
        };
    };

    /* Put `settings` into the deck's master (none left when nothing is set); the copies follow with sync(). */
    App.master.write = function write(doc, settings) {
        let master = doc.querySelector('.master');
        if (master) {
            master.querySelectorAll(':scope > .master-item[data-master]').forEach((item) => item.remove());
        }
        const items = App.master.layout(settings);
        if (items.length) {
            if (!master) {
                master = doc.createElement('div');
                master.className = 'master';
                doc.body.appendChild(master);
            }
            master.setAttribute('data-numbers', settings.numbers === 'n/total' ? 'n/total' : 'n');
            master.setAttribute('data-skip-title', settings.skipTitle ? 'true' : 'false');
            items.forEach((entry) => {
                const item = doc.createElement('div');
                item.className = 'master-item';
                item.setAttribute('data-master', entry.role);
                if (entry.role === 'logo') {
                    item.setAttribute('data-corner', settings.logo.corner);
                }
                App.transform.writeRect(item, entry.rect);
                item.textContent = entry.text;
                master.appendChild(item);
            });
        } else if (master && !master.children.length) {
            master.remove();   // a master of another deck's making keeps its own content
        }
        styleOf(doc).textContent = App.master.css(settings.logo ? settings.logo.src : null);
    };

    /* The first slide, or one with the Title Slide layout. */
    App.master.isTitleSlide = function isTitleSlide(slide, index) {
        return index === 0 || slide.getAttribute('data-layout') === 'title';
    };

    /*
     * Put a copy of the master on every slide (root: the deck's document, or a
     * copy of its <html> being saved). Only what differs is written, so running
     * it again changes nothing.
     */
    App.master.sync = function sync(root) {
        const scope = root.documentElement || root;
        const doc = scope.ownerDocument;
        const master = scope.querySelector('.master');
        const items = master ? Array.from(master.querySelectorAll(':scope > .master-item[data-master]')) : [];
        const format = master ? master.getAttribute('data-numbers') : 'n';
        const skipTitle = !!master && master.getAttribute('data-skip-title') === 'true';
        const slides = Array.from(scope.querySelectorAll('section.slide'));
        slides.forEach((slide, index) => {
            const existing = slide.querySelector(':scope > .master-layer');
            if (!items.length || (skipTitle && App.master.isTitleSlide(slide, index))) {
                if (existing) {
                    existing.remove();
                }
                return;
            }
            const layer = doc.createElement('div');
            layer.className = 'master-layer';
            items.forEach((item) => {
                const copy = item.cloneNode(true);
                if (copy.getAttribute('data-master') === 'number') {
                    copy.textContent = App.master.numberText(index, slides.length, format);
                }
                layer.appendChild(copy);
            });
            if (existing && existing === slide.firstElementChild && existing.outerHTML === layer.outerHTML) {
                return;   // already right: nothing written
            }
            if (existing) {
                existing.remove();
            }
            slide.insertBefore(layer, slide.firstChild);
        });
    };

    /* The copies on the slides (the importer drops them: sync() puts them back). */
    App.master.removeCopies = function removeCopies(doc) {
        doc.querySelectorAll('section.slide > .master-layer, .slide > .master-layer').forEach((layer) => layer.remove());
    };

    // ---------------------------------------------------------------
    // The deck's own footers and numbers
    // ---------------------------------------------------------------
    //
    // A deck made elsewhere (Copilot) often types its footer and page number
    // as ordinary text boxes on each slide; with the master showing them too
    // they would show twice. findOwn finds them so the dialog can offer to
    // remove them. Only small text boxes on the slide itself (not in a group,
    // not locked), on the slides the master shows on, for what the master is
    // going to show:
    //   number: its text is the slide's number ("3", "3 / 15", "Página 3 de 15"),
    //           counting all slides or only the shown ones; by the top or bottom
    //           edge; a pattern: about the same place on at least two slides and
    //           half of them, one per slide (a step badge "3" on slide 3 stays);
    //   footer: in the bottom strip, the same text on at least two slides and
    //           at least half of them;
    //   label:  the label's text, in any case ("CONFIDENCIAL").

    const OWN_MAX_HEIGHT = 60;    // px: a footer line, not a text block
    const BOTTOM_STRIP = 620;     // px from the top: where footers sit (and page numbers)
    const TOP_STRIP = 100;        // px: a page number may also sit above this line
    const SAME_PLACE = 100;       // px: page numbers of one pattern sit this close to its middle
    const NUMBER_RE = /^(?:(?:p[áa]g(?:ina)?|page|slide)\.?\s*)?(\d+)(?:\s*(?:\/|de|of)\s*\d+)?$/i;

    const plainText = (element) => element.textContent.replace(/\s+/g, ' ').trim();

    const middle = (values) => {
        const sorted = values.slice().sort((a, b) => a - b);
        const half = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
    };

    /* Of the boxes showing their slide's number, the pattern: one per slide, near the middle of where they all sit. */
    function numberPattern(candidates, isPattern) {
        const centre = (box) => ({ x: box.rect.left + box.rect.width / 2, y: box.rect.top + box.rect.height / 2 });
        const place = candidates.length
            ? { x: middle(candidates.map((box) => centre(box).x)), y: middle(candidates.map((box) => centre(box).y)) } : null;
        const distance = (box) => Math.hypot(centre(box).x - place.x, centre(box).y - place.y);
        const bySlide = new Map();
        candidates.filter((box) => distance(box) <= SAME_PLACE).forEach((box) => {
            const best = bySlide.get(box.slide);
            if (!best || distance(box) < distance(best)) {
                bySlide.set(box.slide, box);
            }
        });
        const chosen = Array.from(bySlide.values());
        return isPattern(chosen.length) ? chosen : [];
    }

    /* "slide 3", "slides 2–6", "slides 2, 4–5" (numbers from 1, in order). */
    App.master.slideList = function slideList(numbers) {
        const runs = [];
        numbers.forEach((n) => {
            const last = runs[runs.length - 1];
            if (last && n === last[1] + 1) {
                last[1] = n;
            } else {
                runs.push([n, n]);
            }
        });
        return (numbers.length === 1 ? 'slide ' : 'slides ') +
            runs.map((run) => (run[0] === run[1] ? String(run[0]) : run[0] + '–' + run[1])).join(', ');
    };

    /* [{ kind: 'number' | 'footer' | 'label', text, elements, slides }] in that order; [] when there is nothing. */
    App.master.findOwn = function findOwn(doc, settings) {
        const slides = Array.from(doc.querySelectorAll('section.slide'));
        let shownIndex = 0;
        const boxes = [];   // { element, text, rect, numbers: [the slide's numbers] }
        let considered = 0;
        slides.forEach((slide, index) => {
            const hidden = slide.getAttribute('data-hidden') === 'true';
            const numbers = [index + 1].concat(hidden ? [] : [shownIndex + 1]);
            if (!hidden) {
                shownIndex += 1;
            }
            if (settings.skipTitle && App.master.isTitleSlide(slide, index)) {
                return;
            }
            considered += 1;
            Array.from(slide.children).forEach((element) => {
                if (!element.classList.contains('el') || element.getAttribute('data-type') !== 'text' ||
                    element.getAttribute('data-locked') === 'true') {
                    return;
                }
                const rect = App.transform.readRect(element);
                const text = plainText(element);
                if (text && rect.height <= OWN_MAX_HEIGHT) {
                    boxes.push({ element: element, text: text, rect: rect, numbers: numbers, slide: index + 1 });
                }
            });
        });
        const taken = new Set();
        const found = [];
        const take = (kind, text, list) => {
            if (list.length) {
                list.forEach((box) => taken.add(box.element));
                found.push({ kind: kind, text: text, elements: list.map((box) => box.element),
                    slides: list.map((box) => box.slide).filter((n, i, all) => all.indexOf(n) === i) });
            }
        };
        const isPattern = (count) => count >= 2 && count >= considered / 2;
        if (settings.numbers === 'n' || settings.numbers === 'n/total') {
            take('number', '', numberPattern(boxes.filter((box) => {
                const match = NUMBER_RE.exec(box.text);
                const byEdge = box.rect.top >= BOTTOM_STRIP || box.rect.top + box.rect.height <= TOP_STRIP;
                return byEdge && match && box.numbers.indexOf(parseInt(match[1], 10)) !== -1;
            }), isPattern));
        }
        if (settings.footer) {
            const byText = new Map();
            boxes.filter((box) => !taken.has(box.element) && box.rect.top >= BOTTOM_STRIP).forEach((box) => {
                byText.set(box.text, (byText.get(box.text) || []).concat([box]));
            });
            byText.forEach((list, text) => {
                if (isPattern(list.length)) {
                    take('footer', text, list);
                }
            });
        }
        if (settings.label) {
            const wanted = settings.label.toLowerCase();
            const list = boxes.filter((box) => !taken.has(box.element) && box.text.toLowerCase() === wanted);
            take('label', list.length ? list[0].text : '', list);
        }
        return found;
    };

    // ---------------------------------------------------------------
    // In the editor
    // ---------------------------------------------------------------

    App.master.init = function init() {
        // Registered early (app.js): the copies are right before thumbnails, autosave and drafts read the deck.
        ['deck-loaded', 'history-changed'].forEach((name) => App.events.on(name, () => {
            const doc = App.deck.getDocument();
            if (doc && doc.body) {
                App.master.sync(doc);
            }
        }));
    };

    App.master.canEdit = function canEdit() {
        return App.state.hasDeck && !!App.deck.getDocument();
    };

    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    /* The fill-in dialog; Apply puts it on every slide as one undo step ('Slide master'). */
    App.master.open = async function open() {
        if (!App.master.canEdit()) {
            return;
        }
        App.text.exitEdit({ select: true });
        const doc = App.deck.getDocument();
        const current = App.master.read(doc);
        const el = App.util.el;
        let logo = current.logo ? Object.assign({}, current.logo) : null;
        let pending = null;   // the picture being read

        const preview = el('img', { id: 'master-logo-preview', class: 'master-logo-preview', alt: 'Logo' });
        const file = el('input', { id: 'master-logo-file', type: 'file', accept: 'image/*', hidden: true });
        const choose = el('button', { type: 'button', class: 'btn', onclick: () => file.click() }, ['Choose picture…']);
        const remove = el('button', { type: 'button', class: 'btn', onclick: () => { logo = null; showLogo(); } }, ['Remove']);
        const corner = el('select', { id: 'master-logo-corner' }, App.master.CORNERS.map((name) =>
            el('option', { value: name }, [name.charAt(0).toUpperCase() + name.slice(1).replace('-', ' ')])));
        corner.value = logo ? logo.corner : 'top-right';
        const footer = el('input', { id: 'master-footer', type: 'text', autocomplete: 'off', value: current.footer });
        const labelOn = el('input', { id: 'master-label-on', type: 'checkbox' });
        labelOn.checked = !!current.label;
        const labelText = el('input', { id: 'master-label', type: 'text', autocomplete: 'off', value: current.label || 'Confidencial' });
        const numbers = el('select', { id: 'master-numbers' }, [
            el('option', { value: 'none' }, ['None']), el('option', { value: 'n' }, ['3']), el('option', { value: 'n/total' }, ['3 / 15'])]);
        numbers.value = current.numbers;
        const skipTitle = el('input', { id: 'master-skip-title', type: 'checkbox' });
        skipTitle.checked = current.skipTitle;

        function showLogo() {
            preview.hidden = !logo;
            if (logo) {
                preview.src = logo.src;
            } else {
                preview.removeAttribute('src');
            }
            remove.disabled = !logo;
            corner.disabled = !logo;
        }
        file.addEventListener('change', () => {
            const picked = file.files && file.files[0];
            if (!picked) {
                return;
            }
            pending = App.images.compress(picked).then((picture) => {
                const size = App.master.logoSize(picture.width, picture.height);
                logo = { src: picture.src, corner: corner.value, width: size.width, height: size.height };
                showLogo();
            }).catch((error) => App.dialogs.alert('Picture', String(error && error.message ? error.message : error)));
        });
        showLogo();

        const row = (caption, control, extra) => el('div', { class: 'master-row' },
            [el('label', { for: control.id }, [caption]), control].concat(extra || []));
        const body = el('div', { class: 'master-form' }, [
            el('p', { class: 'panel-hint' }, ['Shown on every slide, behind its content. Change it here, in one place.']),
            el('div', { class: 'master-row master-logo-row' }, [el('span', { class: 'master-row-label' }, ['Logo']),
                preview, choose, remove, file]),
            row('Logo corner', corner),
            row('Footer text', footer),
            el('div', { class: 'master-row' }, [labelOn, el('label', { for: 'master-label-on' }, ['Label']), labelText]),
            row('Slide numbers', numbers),
            el('div', { class: 'master-row' }, [skipTitle, el('label', { for: 'master-skip-title' }, ["Don't show on the title slide"])]),
        ]);
        const choice = await App.dialogs.show({ title: 'Slide Master', body: body, buttons: [
            { label: 'Cancel', value: null }, { label: 'Apply', value: true, primary: true }] });
        if (choice !== true) {
            return;
        }
        if (pending) {
            await pending;
        }
        const settings = {
            logo: logo ? Object.assign({}, logo, { corner: corner.value }) : null,
            footer: footer.value.trim(),
            label: labelOn.checked ? labelText.value.trim() : '',
            numbers: numbers.value,
            skipTitle: skipTitle.checked,
        };
        if (same(settings, current) || (same(App.master.layout(settings), []) && same(App.master.layout(current), []))) {
            return;
        }
        // The deck's own footers and numbers would show twice: offer to remove them, with the master as one step.
        const own = await App.master.askOwn(doc, settings);
        if (!own) {
            return;
        }
        App.history.change('Slide master', 'deck', () => App.master.applyInStep(doc, settings, own));
    };

    /*
     * Before `settings` goes on the slides: the deck's own footers / numbers it
     * would double (findOwn), and the user's answer. Resolves { groups, remove }
     * ({ groups: [] } when there are none), or null for Cancel.
     */
    App.master.askOwn = async function askOwn(doc, settings) {
        const groups = App.master.findOwn(doc, settings);
        if (!groups.length) {
            return { groups: groups, remove: false };
        }
        const answer = await App.dialogs.show({ title: 'Already on the slides', body: ownList(groups), buttons: [
            { label: 'Cancel', value: null }, { label: 'Keep them', value: 'keep' },
            { label: 'Remove them', value: 'remove', primary: true }] });
        return answer ? { groups: groups, remove: answer === 'remove' } : null;
    };

    /* Inside a history step: the deck's own boxes removed if so answered (askOwn), the master written and synced. */
    App.master.applyInStep = function applyInStep(doc, settings, own) {
        if (own && own.remove) {
            own.groups.forEach((group) => group.elements.forEach((element) => element.remove()));
        }
        App.master.write(doc, settings);
        App.master.sync(doc);
    };

    /* What findOwn found, for the question: "Slide numbers on slides 2–15", "“Projeto Atlas” on slides 2–15". */
    function ownList(own) {
        const el = App.util.el;
        return el('div', { class: 'master-own' }, [
            el('p', {}, ['This deck has its own text boxes for these. With the slide master they would show twice:']),
            el('ul', {}, own.map((group) => el('li', {}, [
                (group.kind === 'number' ? 'Slide numbers' : '“' + group.text + '”') + ' on ' + App.master.slideList(group.slides)]))),
            el('p', { class: 'panel-hint' }, ['Remove them: the slide master takes their place (one Ctrl+Z undoes both).']),
        ]);
    }
})();
