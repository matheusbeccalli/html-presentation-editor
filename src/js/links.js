/*
 * links.js - hyperlinks on text (Phase 10, Ctrl+K), the window and following them.
 *
 * Insert > Link or Ctrl+K opens a window: Text to display (only when there is
 * no text to link at the cursor), and where the link goes: a web page or
 * e-mail (the Address box: www.x.com and a@b.com are understood) or a slide of
 * this deck (a list of the slides by number and title). On a link it shows
 * where it goes and offers Remove Link. The text model is text.js's
 * (linkAction, an <a href> in the text; #slide-<id> for a slide).
 *
 * Following a link: Ctrl+click on it in the editor (while typing too) goes to
 * the slide, or opens the page or e-mail in a new window; in the slide show a
 * plain click does (present.js), and in the saved deck (player.js).
 *
 * Talks to: text.js, dialogs.js, deck.js, slides.js (titleOf), commands.js.
 */

(function () {
    'use strict';

    App.links = {};

    const el = (tag, attrs, children) => App.util.el(tag, attrs, children);

    /* The slide list of the window: "3. Comparáveis de mercado" (hidden slides say so). */
    function slideOptions(currentId) {
        return App.deck.getSlides().map((slide, index) => {
            const title = App.slides.titleOf(slide);
            const text = title ? title.textContent.replace(/\s+/g, ' ').trim() : '';
            const id = slide.getAttribute('data-slide-id');
            return el('option', { value: id, selected: id === currentId }, [
                (index + 1) + '. ' + (text ? text.slice(0, 50) : 'Slide ' + (index + 1)) + (App.slides.isHidden(slide) ? ' (hidden)' : '')]);
        });
    }

    /* Follow `href`: a slide of this deck is shown; a web page or e-mail opens outside the editor. */
    App.links.follow = function follow(href) {
        const kind = App.text.linkKind(href);
        if (kind === 'slide') {
            const index = App.deck.getSlides().findIndex((slide) => slide.getAttribute('data-slide-id') === App.text.slideIdOf(href));
            if (index === -1) {
                App.ui.setStatus('That slide is no longer in the deck');
                return false;
            }
            App.deck.goTo(index);
            return true;
        }
        if (kind === 'web' || kind === 'email') {
            window.open(href, '_blank', 'noopener');
            return true;
        }
        return false;
    };

    /* Ctrl+click on the slide (not typing): a link under slide point (x, y) is followed; true if there was one. */
    App.links.followAt = function followAt(x, y) {
        const doc = App.deck.getDocument();
        const node = doc && doc.elementFromPoint(x, y);
        const link = node && node.closest && node.closest('.el a[href]');
        return !!link && App.links.follow(link.getAttribute('href'));
    };

    /* Insert > Link, Ctrl+K: the window, then the change as one undo step. */
    App.links.openDialog = async function openDialog() {
        const target = App.text.linkTarget();
        if (!target) {
            return;
        }
        const existing = App.text.linkAt(target.element, target.caret);
        const withText = !!existing || !!App.text.linkAction(target.element, target.caret, 'https://x', null);
        const kind = existing ? App.text.linkKind(existing.href) : 'web';
        const display = el('input', { id: 'link-display', type: 'text', autocomplete: 'off', spellcheck: 'false' });
        const address = el('input', { id: 'link-address', type: 'text', autocomplete: 'off', spellcheck: 'false',
            placeholder: 'www.example.com or name@example.com',
            value: existing && kind !== 'slide' ? existing.href.replace(/^mailto:/i, '') : '' });
        const slides = el('select', { id: 'link-slide' }, slideOptions(existing && kind === 'slide' ? App.text.slideIdOf(existing.href) : null));
        const webChoice = el('input', { type: 'radio', name: 'link-kind', id: 'link-kind-web', value: 'web', checked: kind !== 'slide' });
        const slideChoice = el('input', { type: 'radio', name: 'link-kind', id: 'link-kind-slide', value: 'slide', checked: kind === 'slide' });
        const sync = () => {
            address.disabled = !webChoice.checked;
            slides.disabled = !slideChoice.checked;
        };
        webChoice.addEventListener('change', sync);
        slideChoice.addEventListener('change', sync);
        address.addEventListener('focus', () => { webChoice.checked = true; sync(); });
        slides.addEventListener('focus', () => { slideChoice.checked = true; sync(); });
        sync();
        const body = el('div', { class: 'link-form' }, [
            withText ? null : el('label', { class: 'link-row' }, [el('span', {}, ['Text to display']), display]),
            el('label', { class: 'link-choice' }, [webChoice, ' Web page or e-mail']),
            el('div', { class: 'link-row' }, [address]),
            el('label', { class: 'link-choice' }, [slideChoice, ' A slide in this deck']),
            el('div', { class: 'link-row' }, [slides]),
            el('p', { class: 'panel-hint' }, ['Ctrl+click a link to follow it here; in the slide show and the saved deck a click does.']),
        ].filter(Boolean));
        const buttons = [{ label: 'Cancel', value: null }];
        if (existing) {
            buttons.push({ label: 'Remove Link', value: 'remove' });
        }
        buttons.push({ label: 'OK', value: 'ok', primary: true });
        const shown = App.dialogs.show({ title: existing ? 'Edit Link' : 'Insert Link', body: body, buttons: buttons, className: 'dialog-link',
            keepEdit: true });
        // Enter in a box presses OK; the first box gets the focus.
        [display, address].forEach((input) => input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                const ok = input.closest('dialog').querySelector('.btn-primary');
                if (ok) {
                    ok.click();
                }
            }
        }));
        (withText ? (kind === 'slide' ? slides : address) : display).focus();
        const choice = await shown;
        if (choice === 'remove') {
            App.text.applyLink(target, null);
            return;
        }
        if (choice !== 'ok') {
            App.text.refocus();
            return;
        }
        const href = slideChoice.checked ? App.text.slideLink(slides.value) : App.text.linkAddress(address.value);
        if (!href) {
            App.ui.setStatus('Not a web address or e-mail: nothing was linked');
            App.text.refocus();
            return;
        }
        const shownText = display.value.trim() || (slideChoice.checked
            ? slides.options[slides.selectedIndex].textContent.replace(/ \(hidden\)$/, '') : address.value.trim());
        if (!App.text.applyLink(target, href, shownText)) {
            App.ui.setStatus('Select some text, or type in a box, to add a link');
        }
    };

    App.links.canLink = function canLink() {
        return !!App.text.linkTarget();
    };

    /* While typing, Ctrl+click on a link follows it (a plain click just places the cursor, as in PowerPoint). */
    App.links.init = function init() {
        const wired = new WeakSet();
        App.events.on('deck-loaded', () => {
            const doc = App.deck.getDocument();
            if (!doc || wired.has(doc)) {
                return;
            }
            wired.add(doc);
            doc.addEventListener('click', (event) => {
                const link = (event.ctrlKey || event.metaKey) && event.target.closest && event.target.closest('.el a[href]');
                if (link) {
                    event.preventDefault();
                    App.links.follow(link.getAttribute('href'));
                }
            }, true);
        });
    };
})();
