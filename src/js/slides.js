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
 * shown (never the last one left). A slide moves by dragging its thumbnail
 * (thumbnails.js; gapAt says where it lands) or with Ctrl+Up / Ctrl+Down in
 * the rail. Hide Slide marks it data-hidden="true": the player skips it.
 *
 * Adding, duplicating, deleting and moving are each one undo step of the
 * history's { slides: [...] } scope: only the slide that comes or goes is
 * copied (none for a move), not the whole deck. Undo / redo show the slide the
 * step was about. Hiding is a step of that one slide.
 *
 * Talks to: deck.js, history.js, text.js (the text of new boxes), elements.js
 * (nothing selected), commands.js (newSlide, duplicateSlide, deleteSlide,
 * hideSlide), ribbon.js (the New Slide gallery), thumbnails.js (drag, keys and
 * right-click).
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
        return App.elements.usedIds(doc);   // review comments' targets count too
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

    /*
     * A copy of `slide` (content, notes, comments, hidden or not) with id `slideId` and new element ids;
     * its review comments point at the copies of their elements (comments.remapCopy). taken (several
     * copies made before any goes into the deck): { elements: Set, comments: Set } of ids given out so far.
     */
    App.slides.copyOf = function copyOf(slide, slideId, taken) {
        const used = taken ? taken.elements : usedElementIds(slide.ownerDocument);
        const copy = slide.cloneNode(true);
        copy.setAttribute('data-slide-id', slideId);
        copy.removeAttribute('data-editor-current');
        const idMap = new Map();
        copy.querySelectorAll('[data-id]').forEach((node) => {
            const id = App.util.uniqueId('e', used);
            idMap.set(node.getAttribute('data-id'), id);
            node.setAttribute('data-id', id);
        });
        App.comments.remapCopy(copy, idMap, slide.ownerDocument, taken ? taken.comments : null);
        return copy;
    };

    /*
     * Reordering by dragging a thumbnail: `middles` are the thumbnails' vertical
     * middles (top to bottom); the pointer at `y` is in gap 0 (above the first)
     * ... n (below the last).
     */
    App.slides.gapAt = function gapAt(middles, y) {
        return middles.filter((middle) => middle < y).length;
    };

    /* Move slide number `from` into gap `gap` (see gapAt). False when that leaves it where it is. */
    App.slides.moveSlide = function moveSlide(doc, from, gap) {
        const slides = Array.from(doc.querySelectorAll('section.slide'));
        const slide = slides[from];
        if (!slide || gap === from || gap === from + 1 || gap < 0 || gap > slides.length) {
            return false;
        }
        if (gap === slides.length) {
            slides[slides.length - 1].after(slide);
        } else {
            slides[gap].before(slide);
        }
        return true;
    };

    // ---------------------------------------------------------------
    // Several slides at once, and slides on the clipboard (Phase 10, pure)
    // ---------------------------------------------------------------

    /* Shift+click: the ids from `fromId` to `toId` (either way round) in `ids`; just toId without an anchor. */
    App.slides.rangeIds = function rangeIds(ids, fromId, toId) {
        const a = ids.indexOf(fromId);
        const b = ids.indexOf(toId);
        if (b === -1) {
            return [];
        }
        if (a === -1) {
            return [toId];
        }
        return ids.slice(Math.min(a, b), Math.max(a, b) + 1);
    };

    /*
     * Move the slides `ids` (kept in deck order, together) into gap `gap` of
     * the order before the move (0: before the first ... n: after the last).
     * False when they would end up where they are; dryRun: only say whether they would move.
     */
    App.slides.moveBlock = function moveBlock(doc, ids, gap, dryRun) {
        const slides = Array.from(doc.querySelectorAll('section.slide'));
        const moving = slides.filter((slide) => ids.indexOf(slide.getAttribute('data-slide-id')) !== -1);
        if (!moving.length || gap < 0 || gap > slides.length) {
            return false;
        }
        const staying = slides.filter((slide) => moving.indexOf(slide) === -1);
        const before = slides.slice(0, gap).filter((slide) => moving.indexOf(slide) === -1).length;
        const order = staying.slice(0, before).concat(moving, staying.slice(before));
        if (order.every((slide, index) => slide === slides[index])) {
            return false;
        }
        if (dryRun) {
            return true;
        }
        const anchor = slides[slides.length - 1].nextSibling;
        const parent = slides[0].parentNode;
        order.forEach((slide) => parent.insertBefore(slide, anchor));
        return true;
    };

    const CLIPBOARD_MARK = 'data-deck-editor-slides';

    /*
     * Copied slides as they go on the clipboard (text/html): a <div> marked
     * data-deck-editor-slides holding the slides as they are (notes and
     * comments too), so another editor tab can paste them whole.
     */
    App.slides.clipboardHtml = function clipboardHtml(slides) {
        const box = slides[0].ownerDocument.createElement('div');
        box.setAttribute(CLIPBOARD_MARK, '1');
        slides.forEach((slide) => {
            const copy = slide.cloneNode(true);
            copy.removeAttribute('data-editor-current');
            box.appendChild(copy);
        });
        return box.outerHTML;
    };

    /*
     * The slides in clipboard HTML, ready to go into deck `doc`: cleaned as an
     * opened deck is (no scripts, handlers or frames), their slide-master copy
     * dropped (this deck's master is put on them), new slide and element ids
     * (comments follow their elements). null when the HTML holds no copied slides.
     */
    App.slides.slidesFromClipboard = function slidesFromClipboard(html, doc) {
        if (!html || html.indexOf(CLIPBOARD_MARK) === -1) {
            return null;
        }
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const box = parsed.querySelector('[' + CLIPBOARD_MARK + ']');
        const found = box ? Array.from(box.querySelectorAll(':scope > section.slide')) : [];
        if (!found.length) {
            return null;
        }
        App.importer.sanitize(parsed);
        const slideIds = new Set(Array.from(doc.querySelectorAll('section.slide'), (slide) => slide.getAttribute('data-slide-id')));
        const taken = {
            elements: usedElementIds(doc),
            comments: new Set(Array.from(doc.querySelectorAll('.comment[data-comment-id]'), (node) => node.getAttribute('data-comment-id'))),
        };
        return found.map((slide) => {
            slide.querySelectorAll(':scope > .master-layer').forEach((layer) => layer.remove());
            slide.removeAttribute('data-editor-current');
            return App.slides.copyOf(doc.importNode(slide, true), App.util.uniqueId('s', slideIds), taken);
        });
    };

    /* A hidden slide is skipped when presenting (the player, Phase 8); the editor shows it dimmed. */
    App.slides.isHidden = function isHidden(slide) {
        return !!slide && slide.getAttribute('data-hidden') === 'true';
    };

    App.slides.setHidden = function setHidden(slide, hidden) {
        if (hidden) {
            slide.setAttribute('data-hidden', 'true');
        } else {
            slide.removeAttribute('data-hidden');
        }
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

    // ---- Several slides picked in the rail (Phase 10) ----
    //
    // Shift+click picks a range, Ctrl+click one more (or one fewer); the slide
    // shown is always one of them. With nothing more picked, the slide actions
    // act on the slide shown, as before. Moving to a slide any other way (a
    // click, Page Down, a new slide) picks just that one again.

    let picked = [];        // ids of the picked slides (deck order), or [] for just the slide shown
    let anchorId = null;    // where a Shift+click range starts
    let picking = false;    // true while pick() moves to a slide, so that move keeps the picks

    function setPicked(ids) {
        const order = App.deck.getSlides().map(idOf);
        const kept = order.filter((id) => ids.indexOf(id) !== -1);
        picked = kept.length > 1 ? kept : [];
        App.events.emit('slide-picks-changed', { ids: picked.slice() });
    }

    /* The slides the slide actions act on: the picked ones in deck order, else the slide shown. */
    App.slides.selectedSlides = function selectedSlides() {
        const slides = App.deck.getSlides();
        if (picked.length) {
            return slides.filter((slide) => picked.indexOf(idOf(slide)) !== -1);
        }
        const current = App.deck.getCurrentSlide();
        return current ? [current] : [];
    };

    App.slides.pickedIds = function pickedIds() {
        return picked.slice();
    };

    /* A click on thumbnail `index`: how = 'single' (just it), 'toggle' (Ctrl: in or out) or 'range' (Shift). */
    App.slides.pick = function pick(index, how) {
        const slides = App.deck.getSlides();
        const slide = slides[index];
        if (!slide) {
            return;
        }
        const id = idOf(slide);
        const current = idOf(App.deck.getCurrentSlide());
        let show = index;
        if (how === 'range') {
            setPicked(App.slides.rangeIds(slides.map(idOf), anchorId || current, id));
        } else if (how === 'toggle') {
            const base = picked.length ? picked.slice() : [current];
            const next = base.indexOf(id) === -1 ? base.concat([id]) : base.filter((one) => one !== id);
            if (!next.length) {
                next.push(id);
            }
            anchorId = id;
            setPicked(next);
            if (next.indexOf(id) === -1) {
                show = slides.findIndex((one) => idOf(one) === next[next.length - 1]);   // taken out: show a picked one
            }
        } else {
            anchorId = id;
            setPicked([]);
        }
        picking = true;
        try {
            App.deck.goTo(show);
        } finally {
            picking = false;
        }
    };

    App.slides.duplicate = function duplicate() {
        finishWork();
        const targets = App.slides.selectedSlides();
        if (!targets.length) {
            return;
        }
        const doc = targets[0].ownerDocument;
        const slideIds = new Set(App.deck.getSlides().map(idOf));
        const taken = { elements: usedElementIds(doc), comments: new Set(Array.from(doc.querySelectorAll('.comment[data-comment-id]'),
            (node) => node.getAttribute('data-comment-id'))) };
        const copies = targets.map((slide) => App.slides.copyOf(slide, App.util.uniqueId('s', slideIds), taken));
        insertAfter(targets.length > 1 ? 'Duplicate slides' : 'Duplicate slide', targets[targets.length - 1], copies);
    };

    /*
     * Put `slides` (not in the deck yet) after `after` as one undo step called
     * `label`, show the first; several stay picked.
     */
    function insertAfter(label, after, slides) {
        const ids = slides.map(idOf);
        App.history.change(label, { slides: ids }, () => {
            let previous = after;
            slides.forEach((slide) => {
                if (previous) {
                    previous.after(slide);
                } else {
                    App.deck.getDocument().body.appendChild(slide);
                }
                previous = slide;
            });
        }, { meta: { slides: { undo: idOf(App.deck.getCurrentSlide()), redo: ids[0] } } });
        show(ids[0]);
        setPicked(ids);
    }

    /* A deck keeps at least one slide: the picked slides can go if one stays. */
    App.slides.canRemove = function canRemove() {
        return App.deck.getSlides().length > App.slides.selectedSlides().length;
    };

    /* Delete the picked slides (or the slide shown); the next one (the previous one, after the last) is shown. */
    App.slides.remove = function remove() {
        if (!App.slides.canRemove()) {
            return;
        }
        finishWork();
        const slides = App.deck.getSlides();
        const targets = App.slides.selectedSlides();
        const last = slides.indexOf(targets[targets.length - 1]);
        const first = slides.indexOf(targets[0]);
        const neighbour = slides.slice(last + 1).find((slide) => targets.indexOf(slide) === -1) ||
            slides.slice(0, first).reverse().find((slide) => targets.indexOf(slide) === -1);
        App.history.change(targets.length > 1 ? 'Delete slides' : 'Delete slide', { slides: targets.map(idOf) },
            () => targets.forEach((slide) => slide.remove()),
            { meta: { slides: { undo: idOf(targets[0]), redo: idOf(neighbour) } } });
        setPicked([]);
        show(idOf(neighbour));
    };

    /*
     * Move slide number `from` into gap `gap` as one undo step; the moved slide is shown (after undo too).
     * A picked slide takes the other picked ones with it.
     */
    App.slides.move = function move(from, gap) {
        const slide = App.deck.getSlides()[from];
        const doc = App.deck.getDocument();
        if (!slide) {
            return;
        }
        const ids = picked.indexOf(idOf(slide)) !== -1 ? picked.slice() : [idOf(slide)];
        if (!App.slides.moveBlock(doc, ids, gap, true)) {   // it would not move: no empty undo step
            return;
        }
        finishWork();
        App.history.change(ids.length > 1 ? 'Move slides' : 'Move slide', { slides: [] }, () => App.slides.moveBlock(doc, ids, gap),
            { meta: { slides: { undo: idOf(slide), redo: idOf(slide) } } });
        picking = true;
        try {
            show(idOf(slide));
        } finally {
            picking = false;
        }
    };

    /* Ctrl+Up / Ctrl+Down in the slide rail: the slide shown (the picked slides) one place up (-1) or down (+1). */
    App.slides.moveBy = function moveBy(delta) {
        const slides = App.deck.getSlides();
        const targets = App.slides.selectedSlides();
        const first = slides.indexOf(targets[0]);
        const last = slides.indexOf(targets[targets.length - 1]);
        const gap = delta < 0 ? first - 1 : last + 2;
        if (gap >= 0 && gap <= slides.length && targets.length) {
            App.slides.move(slides.indexOf(App.deck.getCurrentSlide()), gap);
        }
    };

    /* Hide Slide: on / off for the picked slides (hidden if any of them shows), one undo step. */
    App.slides.toggleHidden = function toggleHidden() {
        const targets = App.slides.selectedSlides();
        if (!targets.length) {
            return;
        }
        const hide = targets.some((slide) => !App.slides.isHidden(slide));
        const label = (hide ? 'Hide slide' : 'Unhide slide') + (targets.length > 1 ? 's' : '');
        App.history.change(label, targets.length > 1 ? { slides: targets.map(idOf) } : { slideId: idOf(targets[0]) },
            () => targets.forEach((slide) => App.slides.setHidden(slide, hide)));
    };

    // ---- Copy, Cut and Paste slides (Phase 10) ----

    let copied = null;   // the last slides copied in this tab, as clipboard HTML (for the Paste command)

    /* Copy (cut: and delete) the picked slides; returns their clipboard HTML. */
    App.slides.copySlides = function copySlides(cut) {
        const targets = App.slides.selectedSlides();
        if (!targets.length || (cut && !App.slides.canRemove())) {
            return null;
        }
        copied = App.slides.clipboardHtml(targets);
        if (cut) {
            App.slides.remove();
        }
        return copied;
    };

    App.slides.hasCopiedSlides = function hasCopiedSlides() {
        return copied !== null;
    };

    /*
     * Paste slides from clipboard HTML (none: the last copied here) after the picked slides; false if it holds none.
     * label: the undo step's name (Reuse Slides gives its own).
     */
    App.slides.paste = function paste(html, label) {
        const doc = App.deck.getDocument();
        const slides = doc ? App.slides.slidesFromClipboard(html || copied, doc) : null;
        if (!slides || !slides.length) {
            return false;
        }
        finishWork();
        const targets = App.slides.selectedSlides();
        const after = targets[targets.length - 1] || null;
        // This deck's slide-master copy, as the slide they follow shows it (numbers are set again on save).
        const layer = after && after.querySelector(':scope > .master-layer');
        if (layer) {
            slides.forEach((slide) => slide.insertBefore(layer.cloneNode(true), slide.firstChild));
        }
        insertAfter(label || (slides.length > 1 ? 'Paste slides' : 'Paste slide'), after, slides);
        return true;
    };

    /* A copy or cut event in the slide rail: the picked slides go on the system clipboard. */
    App.slides.onCopyEvent = function onCopyEvent(event) {
        const titles = App.slides.selectedSlides().map((slide) => {
            const title = App.slides.titleOf(slide);
            return title ? title.textContent.replace(/\s+/g, ' ').trim() : '';
        }).filter(Boolean).join('\n');
        const html = App.slides.copySlides(event.type === 'cut');
        if (!html) {
            return;
        }
        event.preventDefault();
        event.clipboardData.setData('text/html', html);
        event.clipboardData.setData('text/plain', titles);   // pasted into an e-mail: the slides' titles
    };

    /* A paste event holding copied slides (this tab's or another editor tab's): pasted. True if it did. */
    App.slides.onPasteEvent = function onPasteEvent(event) {
        const html = event.clipboardData && event.clipboardData.getData('text/html');
        if (!html || html.indexOf('data-deck-editor-slides') === -1) {
            return false;
        }
        event.preventDefault();
        return App.slides.paste(html);
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
        }, [el('div', { class: 'table-grid-label' }, ['Layouts']), el('div', { class: 'slide-layout-grid' }, items),
            // Phase 10: slides from another deck.
            el('button', { type: 'button', class: 'menu-item reuse-slides-item', onclick: () => {
                closeGallery();
                App.commands.run('reuseSlides');
            } }, [el('span', { class: 'menu-label' }, ['Reuse Slides…'])])]);
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
        // Moving to a slide any other way than a Shift / Ctrl+click picks just that one (Phase 10).
        App.events.on('slide-changed', () => {
            if (!picking && picked.length && picked.indexOf(idOf(App.deck.getCurrentSlide())) === -1) {
                setPicked([]);
            }
        });
        App.events.on('deck-loaded', () => {
            anchorId = null;
            setPicked([]);
        });
        App.events.on('history-changed', (info) => {
            if (info && (info.action === 'undo' || info.action === 'redo')) {
                setPicked([]);
            }
        });
        // Undo / redo of a slide step show the slide it was about (the deleted one back, the new one again).
        App.events.on('history-changed', (info) => {
            if (info && (info.action === 'undo' || info.action === 'redo') && info.meta && info.meta.slides) {
                show(info.meta.slides[info.action]);
            }
        });
        App.events.on('deck-loaded', closeGallery);
    };
})();
