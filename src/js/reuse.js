/*
 * reuse.js - Reuse Slides (Phase 10): slides from another deck into this one.
 *
 * Home > New Slide ▾ > Reuse Slides… opens a window: Browse… picks another
 * deck's .html, which is read the way File > Open reads a deck (importer.js:
 * cleaned, a Copilot deck laid out as slides) but is not opened; its slides
 * show as small pictures with a tick box each. Insert puts the ticked ones
 * after the slide shown, as one undo step, through the same path as pasting
 * copied slides (slides.js): new ids, notes and comments come along, pictures
 * and charts too, this deck's slide master on them. Their text uses this
 * deck's theme where it was theme-linked; the other deck's master is not
 * brought in.
 *
 * Talks to: importer.js (importDeck), slides.js (clipboardHtml, paste),
 * thumbnails.js (miniature), dialogs.js, ui.js.
 */

(function () {
    'use strict';

    App.reuse = {};

    const el = (tag, attrs, children) => App.util.el(tag, attrs, children);
    const MINIATURE_WIDTH = 168;

    /* Read another deck's file as the editor would open it; resolves { doc, slides, name } (not opened). */
    App.reuse.readDeck = async function readDeck(file) {
        const text = await file.text();
        const result = await App.importer.importDeck(text);
        const doc = new DOMParser().parseFromString(result.html, 'text/html');
        const meta = doc.head.querySelector('meta[name="deck-id"]');
        return { doc: doc, slides: Array.from(doc.querySelectorAll('section.slide')), name: file.name,
            deckId: meta ? meta.getAttribute('content') : null };
    };

    /* The ticked slides of the window, in their deck's order. */
    function tickedSlides(state, list) {
        return Array.from(list.querySelectorAll('input.reuse-tick'))
            .filter((box) => box.checked)
            .map((box) => state.slides[Number(box.getAttribute('data-index'))]);
    }

    App.reuse.open = async function open() {
        const state = { doc: null, slides: [], name: '', deckId: null };
        const file = el('input', { id: 'reuse-file', type: 'file', accept: '.html,.htm,text/html', hidden: true });
        const browse = el('button', { type: 'button', class: 'btn', onclick: () => file.click() }, ['Browse…']);
        const name = el('span', { class: 'panel-hint reuse-name' }, ['Pick another deck (.html).']);
        const all = el('input', { type: 'checkbox', id: 'reuse-all', disabled: true });
        const list = el('div', { class: 'reuse-grid', id: 'reuse-grid' });
        const body = el('div', { class: 'reuse-form' }, [
            el('div', { class: 'reuse-head' }, [browse, file, name]),
            el('label', { class: 'reuse-all' }, [all, ' Select all']),
            list,
            el('p', { class: 'panel-hint' }, ['The slides come in after the slide shown, with their notes, pictures and charts. ' +
                'Text that follows the theme takes this deck\'s colours and fonts; the other deck\'s slide master stays behind.']),
        ]);
        const shown = App.dialogs.show({ title: 'Reuse Slides', body: body, wide: true, className: 'dialog-reuse',
            buttons: [{ label: 'Cancel', value: null }, { label: 'Insert', value: 'insert', primary: true }] });
        const insertButton = body.closest('dialog').querySelector('.btn-primary');
        const refresh = () => {
            const count = tickedSlides(state, list).length;
            insertButton.disabled = count === 0;
            insertButton.textContent = count > 1 ? 'Insert ' + count + ' slides' : 'Insert';
            all.checked = count > 0 && count === state.slides.length;
        };
        all.addEventListener('change', () => {
            list.querySelectorAll('input.reuse-tick').forEach((box) => { box.checked = all.checked; });
            refresh();
        });
        file.addEventListener('change', async () => {
            const picked = file.files && file.files[0];
            if (!picked) {
                return;
            }
            name.textContent = 'Reading ' + picked.name + '…';
            list.replaceChildren();
            try {
                Object.assign(state, await App.reuse.readDeck(picked));
            } catch (error) {
                name.textContent = 'Could not read ' + picked.name + ': ' + error.message;
                return;
            }
            name.textContent = picked.name + ': ' + state.slides.length + ' slide' + (state.slides.length === 1 ? '' : 's') +
                '. Tick the ones to insert.';
            all.disabled = state.slides.length === 0;
            list.replaceChildren(...state.slides.map((slide, index) => {
                const tick = el('input', { type: 'checkbox', class: 'reuse-tick', 'data-index': String(index),
                    'aria-label': 'Slide ' + (index + 1) });
                tick.addEventListener('change', refresh);
                return el('label', { class: 'reuse-item' + (App.slides.isHidden(slide) ? ' reuse-hidden' : ''),
                    title: 'Slide ' + (index + 1) + (App.slides.isHidden(slide) ? ' (hidden)' : '') }, [
                    App.thumbnails.miniature(state.doc, slide, MINIATURE_WIDTH),
                    el('span', { class: 'reuse-number' }, [tick, ' ' + (index + 1)]),
                ]);
            }));
            refresh();
        });
        refresh();
        const choice = await shown;
        const chosen = tickedSlides(state, list);
        if (choice !== 'insert' || !chosen.length) {
            return;
        }
        const pasted = App.slides.paste(App.slides.clipboardHtml(chosen, state.deckId), chosen.length > 1 ? 'Reuse slides' : 'Reuse slide');
        if (pasted) {
            App.ui.setStatus(chosen.length + ' slide' + (chosen.length === 1 ? '' : 's') + ' inserted from ' + state.name +
                (pasted.removedRemote ? ' · ' + pasted.removedRemote + ' link' + (pasted.removedRemote === 1 ? '' : 's') +
                    ' to pictures or fonts on the internet removed' : ''));
        }
    };
})();
