/*
 * slides.js - adding, duplicating and deleting slides (SPEC 4, Phase 7).
 *
 * New slide: one of four built-in layouts (decided in the Phase 7 Q&A), as in
 * PowerPoint's New Slide gallery:
 *
 *   title          Title Slide         a title and a subtitle
 *   title-content  Title and Content   a title and a bulleted text box
 *   two-columns    Two Content         a title and two text boxes side by side
 *   blank          Blank               nothing
 *
 * The title of a new slide sits where the deck's own titles sit and looks like
 * them: it copies the position and look of the title of an existing slide of
 * the same kind (the deck's title slide for "Title Slide", a content slide for
 * the others). A deck without one gets the built-in title of File > New. Text
 * uses the theme (var(--font-heading), var(--color-accent) ...), so a theme
 * change restyles new slides too. The slide carries data-layout (SPEC 3.3).
 *
 * New and duplicated slides go after the slide shown; delete removes the slide
 * shown (never the last one left). Each is one undo step of the history's
 * { slides: [...] } scope: only the slide that comes or goes is copied, not the
 * whole deck. Undo / redo show the slide the step was about.
 *
 * Talks to: deck.js, history.js, text.js (the text of new boxes), elements.js
 * (nothing selected), commands.js (newSlide, duplicateSlide, deleteSlide),
 * ribbon.js (the New Slide gallery), thumbnails.js (keys and right-click).
 */

(function () {
    'use strict';

    App.slides = {};

    const el = (...args) => App.util.el(...args);

    App.slides.LAYOUTS = [
        { id: 'title', label: 'Title Slide' },
        { id: 'title-content', label: 'Title and Content' },
        { id: 'two-columns', label: 'Two Content' },
        { id: 'blank', label: 'Blank' },
    ];

    const CONTENT_LAYOUTS = ['title-content', 'two-columns'];
    const UPPER_PART = 360;    // a title starts in the upper half of the slide
    const BODY_GAP = 40;       // between the title and the body
    const BOTTOM_MARGIN = 70;  // the body stops this far from the slide's bottom
    const COLUMN_GAP = 48;
    const SUBTITLE_GAP = 28;

    // The built-in titles (as in File > New, template.js) for decks without one to copy.
    const DEFAULT_TITLES = {
        title: 'left: 64px; top: 180px; width: 1152px; height: 110px; font-family: var(--font-heading); font-size: 36pt; ' +
            'font-weight: bold; line-height: 1.15; color: var(--color-accent);',
        content: 'left: 64px; top: 48px; width: 1152px; height: 60px; font-family: var(--font-heading); font-size: 25.5pt; ' +
            'font-weight: bold; line-height: 1.2; color: var(--color-accent);',
    };
    const BODY_LOOK = 'font-family: var(--font-body); font-size: 16.5pt; line-height: 1.4; color: var(--color-text);';
    const TEXTS = {
        title: 'Título da apresentação', subtitle: 'Subtítulo', slideTitle: 'Título do slide',
        body: ['Primeiro ponto', 'Segundo ponto'], column: ['Primeiro ponto'],
    };

    // ---------------------------------------------------------------
    // Building slides (tested in tests/unit/slides.test.js)
    // ---------------------------------------------------------------

    /* A slide id no slide of `doc` has yet: s1, s2 ... */
    App.slides.freshSlideId = function freshSlideId(doc) {
        const used = new Set(Array.from(doc.querySelectorAll('section.slide'), (slide) => slide.getAttribute('data-slide-id')));
        return App.util.uniqueId('s', used);
    };

    function usedElementIds(doc) {
        return new Set(Array.from(doc.querySelectorAll('[data-id]'), (node) => node.getAttribute('data-id')));
    }

    /* A font size written on the element itself, in px (0 when it has none). */
    function fontSizeOf(element) {
        const size = element.style.fontSize;
        const number = parseFloat(size);
        if (!number) {
            return 0;
        }
        return /pt$/.test(size) ? number * 4 / 3 : number;
    }

    /* A slide's title: its largest text box starting in the upper half (the higher one on a tie), or null. */
    App.slides.titleOf = function titleOf(slide) {
        const texts = Array.from(slide.querySelectorAll(':scope > .el[data-type="text"]'))
            .filter((element) => parseFloat(element.style.top) < UPPER_PART);
        texts.sort((a, b) => fontSizeOf(b) - fontSizeOf(a) || parseFloat(a.style.top) - parseFloat(b.style.top));
        return texts[0] || null;
    };

    /*
     * The title a new slide of `layout` copies: from a slide of that layout,
     * else (content layouts) any content slide, else a slide that says no
     * layout (not the first: that is usually the deck's title slide). Or null.
     */
    function referenceTitle(doc, layout) {
        const slides = Array.from(doc.querySelectorAll('section.slide'));
        const kinds = layout === 'title' ? [['title']] : [[layout], CONTENT_LAYOUTS, [null]];
        for (const kind of kinds) {
            for (let i = 0; i < slides.length; i++) {
                const said = slides[i].getAttribute('data-layout');
                if (kind.includes(said) && !(said === null && i === 0)) {
                    const title = App.slides.titleOf(slides[i]);
                    if (title) {
                        return title;
                    }
                }
            }
        }
        return null;
    }

    function textBox(doc, id, style, zIndex) {
        const element = doc.createElement('div');
        element.setAttribute('class', 'el');
        element.setAttribute('data-type', 'text');
        element.setAttribute('data-id', id);
        element.setAttribute('style', style);
        element.style.removeProperty('--autofit-scale');
        element.style.zIndex = String(zIndex);
        return element;
    }

    function rectStyle(left, top, width, height) {
        return 'left: ' + left + 'px; top: ' + top + 'px; width: ' + width + 'px; height: ' + height + 'px; ';
    }

    function boxRect(element) {
        return { left: parseFloat(element.style.left) || 0, top: parseFloat(element.style.top) || 0,
            width: parseFloat(element.style.width) || 0, height: parseFloat(element.style.height) || 0 };
    }

    /*
     * A new slide of `layout` (not yet in the deck) with id `slideId`: its
     * boxes styled like the deck's titles and theme, with element ids no
     * element of `doc` has, and empty speaker notes.
     */
    App.slides.buildSlide = function buildSlide(doc, layout, slideId) {
        const slide = doc.createElement('section');
        slide.setAttribute('class', 'slide');
        slide.setAttribute('data-slide-id', slideId);
        slide.setAttribute('data-layout', layout);
        const used = usedElementIds(doc);
        const nextId = () => App.util.uniqueId('e', used);
        const add = (element, lines, look) => {
            slide.appendChild(element);
            App.text.writeLines(element, lines, look);
        };

        if (layout !== 'blank') {
            const reference = referenceTitle(doc, layout);
            const fallback = DEFAULT_TITLES[layout === 'title' ? 'title' : 'content'];
            const title = textBox(doc, nextId(), reference ? reference.getAttribute('style') : fallback, 1);
            add(title, [layout === 'title' ? TEXTS.title : TEXTS.slideTitle]);
            const rect = boxRect(title);
            const bottom = rect.top + rect.height;

            if (layout === 'title') {
                add(textBox(doc, nextId(), rectStyle(rect.left, bottom + SUBTITLE_GAP, rect.width, 50) + BODY_LOOK, 2),
                    [TEXTS.subtitle]);
            } else {
                const top = bottom + BODY_GAP;
                const height = Math.max(120, 720 - BOTTOM_MARGIN - top);
                if (layout === 'two-columns') {
                    const width = Math.round((rect.width - COLUMN_GAP) / 2);
                    add(textBox(doc, nextId(), rectStyle(rect.left, top, width, height) + BODY_LOOK, 2),
                        TEXTS.column, { list: 'bullet' });
                    add(textBox(doc, nextId(), rectStyle(rect.left + rect.width - width, top, width, height) + BODY_LOOK, 3),
                        TEXTS.column, { list: 'bullet' });
                } else {
                    add(textBox(doc, nextId(), rectStyle(rect.left, top, rect.width, height) + BODY_LOOK, 2),
                        TEXTS.body, { list: 'bullet' });
                }
            }
        }
        const notes = doc.createElement('aside');
        notes.setAttribute('class', 'notes');
        slide.appendChild(notes);
        return slide;
    };

    /* A copy of `slide` (content, notes, hidden or not) with id `slideId` and new element ids. */
    App.slides.copyOf = function copyOf(slide, slideId) {
        const used = usedElementIds(slide.ownerDocument);
        const copy = slide.cloneNode(true);
        copy.setAttribute('data-slide-id', slideId);
        copy.removeAttribute('data-editor-current');
        copy.querySelectorAll('[data-id]').forEach((node) => node.setAttribute('data-id', App.util.uniqueId('e', used)));
        return copy;
    };

    /* The layout New Slide (Ctrl+M) uses: the slide shown's, but content after a title slide (as PowerPoint). */
    App.slides.nextLayout = function nextLayout(slide) {
        const layout = slide && slide.getAttribute('data-layout');
        return layout && layout !== 'title' && App.slides.LAYOUTS.some((entry) => entry.id === layout) ? layout : 'title-content';
    };

    // ---------------------------------------------------------------
    // Actions on the live deck
    // ---------------------------------------------------------------

    function idOf(slide) {
        return slide ? slide.getAttribute('data-slide-id') : null;
    }

    function show(slideId) {
        const index = App.deck.getSlides().findIndex((slide) => idOf(slide) === slideId);
        if (index !== -1) {
            App.deck.goTo(index);
        }
    }

    /* Typing ends and the element selection goes before the slides change, as in PowerPoint. */
    function finishWork() {
        if (App.text.isEditing()) {
            App.text.exitEdit();
        }
        App.selection.clear();
    }

    /* Put `slide` after the slide shown as one undo step called `label`, and show it. */
    function insert(label, slide) {
        const current = App.deck.getCurrentSlide();
        const id = idOf(slide);
        App.history.change(label, { slides: [id] }, () => {
            if (current) {
                current.after(slide);
            } else {
                App.deck.getDocument().body.appendChild(slide);
            }
        }, { meta: { slides: { undo: idOf(current), redo: id } } });
        show(id);
    }

    /* New Slide: `layout` (one of LAYOUTS), or the one nextLayout picks. */
    App.slides.add = function add(layout) {
        finishWork();
        const doc = App.deck.getDocument();
        const chosen = layout || App.slides.nextLayout(App.deck.getCurrentSlide());
        insert('New slide', App.slides.buildSlide(doc, chosen, App.slides.freshSlideId(doc)));
    };

    App.slides.duplicate = function duplicate() {
        finishWork();
        const current = App.deck.getCurrentSlide();
        if (current) {
            insert('Duplicate slide', App.slides.copyOf(current, App.slides.freshSlideId(current.ownerDocument)));
        }
    };

    /* A deck keeps at least one slide. */
    App.slides.canRemove = function canRemove() {
        return App.deck.getSlides().length > 1;
    };

    /* Delete the slide shown; the next one (the previous one, after the last) is shown. */
    App.slides.remove = function remove() {
        if (!App.slides.canRemove()) {
            return;
        }
        finishWork();
        const slides = App.deck.getSlides();
        const index = App.deck.getCurrentIndex();
        const current = slides[index];
        const neighbour = slides[index + 1] || slides[index - 1];
        App.history.change('Delete slide', { slides: [idOf(current)] }, () => current.remove(),
            { meta: { slides: { undo: idOf(current), redo: idOf(neighbour) } } });
        show(idOf(neighbour));
    };

    // ---------------------------------------------------------------
    // Home > New Slide: the layout gallery
    // ---------------------------------------------------------------

    // A small drawing of each layout: the slide, its title (thick) and text lines.
    const PREVIEWS = {
        title: '<path d="M14 15h36" stroke-width="3"/><path d="M14 22h22"/>',
        'title-content': '<path d="M8 8h30" stroke-width="3"/><path d="M8 16h44M8 21h44M8 26h30"/>',
        'two-columns': '<path d="M8 8h30" stroke-width="3"/><path d="M8 16h21M8 21h21M8 26h14M35 16h21M35 21h21M35 26h14"/>',
        blank: '',
    };

    function preview(layout) {
        return '<svg width="64" height="36" viewBox="0 0 64 36" fill="none" stroke="currentColor" stroke-width="1.4" ' +
            'aria-hidden="true"><rect x="0.5" y="0.5" width="63" height="35" rx="1.5" stroke-width="1"/>' + PREVIEWS[layout] + '</svg>';
    }

    let galleryButton = null;
    let gallery = null;

    function closeGallery() {
        if (gallery) {
            gallery.remove();
            gallery = null;
            window.removeEventListener('pointerdown', onOutsidePointerDown, true);
            galleryButton.setAttribute('aria-expanded', 'false');
        }
    }

    function onOutsidePointerDown(event) {
        if (gallery && !gallery.contains(event.target) && !galleryButton.contains(event.target)) {
            closeGallery();
        }
    }

    function openGallery() {
        closeGallery();
        const items = App.slides.LAYOUTS.map((entry) => {
            const item = el('button', {
                type: 'button', class: 'slide-layout-item', 'data-layout': entry.id, title: entry.label,
                onclick: () => {
                    closeGallery();
                    App.commands.run('newSlide', entry.id);
                },
            });
            item.innerHTML = preview(entry.id);
            item.appendChild(el('span', {}, [entry.label]));
            return item;
        });
        gallery = el('div', {
            class: 'menu slide-layout-gallery', role: 'dialog', 'aria-label': 'New slide layout', tabindex: '-1',
            onkeydown: (event) => {
                if (event.key === 'Escape') {
                    event.stopPropagation();
                    closeGallery();
                    galleryButton.focus();
                }
            },
        }, [el('div', { class: 'table-grid-label' }, ['Layouts']), el('div', { class: 'slide-layout-grid' }, items)]);
        const rect = galleryButton.getBoundingClientRect();
        gallery.style.left = rect.left + 'px';
        gallery.style.top = rect.bottom + 'px';
        document.body.appendChild(gallery);
        galleryButton.setAttribute('aria-expanded', 'true');
        window.addEventListener('pointerdown', onOutsidePointerDown, true);
        items[0].focus();
    }

    function createGalleryButton() {
        const keys = App.shortcuts.keysFor('newSlide');
        galleryButton = el('button', {
            type: 'button', class: 'ribbon-button new-slide-button', 'aria-label': 'New Slide',
            title: 'New Slide: pick a layout (' + keys + ' adds one like the slide shown)',
            'aria-haspopup': 'dialog', 'aria-expanded': 'false',
            onclick: () => (gallery ? closeGallery() : openGallery()),
        });
        galleryButton.innerHTML = App.icons.get('newSlide');
        galleryButton.appendChild(el('span', { class: 'ribbon-button-label' }, ['New Slide ▾']));
        return galleryButton;
    }

    /* The ribbon control named `name`, or null when it is not one of these. */
    App.slides.create = function create(name) {
        return name === 'newSlide' ? createGalleryButton() : null;
    };

    App.slides.refresh = function refresh() {
        if (galleryButton) {
            galleryButton.disabled = !App.commands.isEnabled('newSlide');
        }
    };

    /* Wiring, called once from App.start() (after deck.js, whose own history listener goes first). */
    App.slides.init = function init() {
        // Undo / redo of a slide step show the slide it was about (the deleted one back, the new one again).
        App.events.on('history-changed', (info) => {
            if (info && (info.action === 'undo' || info.action === 'redo') && info.meta && info.meta.slides) {
                show(info.meta.slides[info.action]);
            }
        });
        App.events.on('deck-loaded', closeGallery);
    };
})();
