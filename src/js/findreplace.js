/*
 * findreplace.js - Home > Editing: Find (Ctrl+F) and Replace (Ctrl+H) across all slides (SPEC Phase 3).
 *
 * A small panel over the top right of the slide that stays open while you
 * work, as in PowerPoint. Find Next (Enter) goes to the next match, slide by
 * slide and box by box (hidden slides too), and selects it in its text box;
 * Shift+Enter goes back. Every match in the deck is painted with the CSS
 * Custom Highlight API (::highlight rules in deck.js's editor-only CSS): the
 * browser draws them from Ranges, so the deck's HTML is never changed and
 * nothing has to be cleaned up before saving.
 *
 * The "current" match is simply the one selected in the box being edited, so
 * moving the cursor away from it needs no bookkeeping.
 *
 * Text boxes and table cells are searched, in reading order (text.containersIn;
 * speaker notes join once they can be edited in Phase 7). All text work goes
 * through text.js.
 *
 * Talks to: text.js (findMatches, matchRange, selectMatch, replaceText, replaceAll),
 *           deck.js, history.js, selection.js, commands.js (the find / replace commands).
 */

(function () {
    'use strict';

    App.findReplace = {};

    const el = (...args) => App.util.el(...args);

    let nodes = null;        // the panel's elements, built on first use
    let note = null;         // until the next search: { text, alone } shown after the count, or alone ("Replaced 7")
    let refreshFrame = 0;

    function build() {
        const input = (id, label) => el('input', { id: id, type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': label });
        const tick = (id, label) => el('label', { class: 'find-option' }, [el('input', { id: id, type: 'checkbox' }), ' ' + label]);
        const button = (id, label) => el('button', { id: id, type: 'button', class: 'btn' }, [label]);
        nodes = {
            find: input('find-text', 'Find what'),
            replace: input('find-replacement', 'Replace with'),
            title: el('span', { class: 'find-title' }),
            next: button('find-next', 'Find Next'),
            showReplace: button('find-show-replace', 'Replace…'),
            replaceOne: button('find-replace', 'Replace'),
            replaceAll: button('find-replace-all', 'Replace All'),
            close: el('button', { type: 'button', class: 'find-close', 'aria-label': 'Close', title: 'Close (Esc)' }, ['×']),
            status: el('div', { id: 'find-status', 'aria-live': 'polite' }),
        };
        nodes.replaceRow = el('label', { class: 'find-field' }, ['Replace with', nodes.replace]);
        // data-keep-edit: working in the panel does not end typing in the text box (text.js).
        nodes.root = el('div', { id: 'find-panel', role: 'dialog', 'aria-label': 'Find and replace', 'data-keep-edit': '', hidden: true }, [
            el('div', { class: 'find-header' }, [nodes.title, nodes.close]),
            el('label', { class: 'find-field' }, ['Find what', nodes.find]),
            nodes.replaceRow,
            el('div', { class: 'find-options' }, [tick('find-match-case', 'Match case'), tick('find-whole-word', 'Find whole words only')]),
            el('div', { class: 'find-buttons' }, [nodes.next, nodes.showReplace, nodes.replaceOne, nodes.replaceAll]),
            nodes.status,
        ]);
        nodes.matchCase = nodes.root.querySelector('#find-match-case');
        nodes.wholeWord = nodes.root.querySelector('#find-whole-word');
        document.getElementById('center').appendChild(nodes.root);

        nodes.next.addEventListener('click', () => findNext(true));
        nodes.showReplace.addEventListener('click', () => App.findReplace.open('replace'));
        nodes.replaceOne.addEventListener('click', replaceOne);
        nodes.replaceAll.addEventListener('click', replaceAll);
        nodes.close.addEventListener('click', () => App.findReplace.close());
        [nodes.find, nodes.matchCase, nodes.wholeWord].forEach((node) => node.addEventListener('input', () => {
            note = null;
            scheduleRefresh();
        }));
        nodes.root.addEventListener('keydown', onKeyDown);
        nodes.root.querySelector('.find-header').addEventListener('pointerdown', startDrag);
    }

    /* The panel can be dragged by its title, like PowerPoint's dialog (kept inside the slide area). */
    function startDrag(event) {
        if (event.button !== 0 || event.target.closest('button')) {
            return;
        }
        event.preventDefault();
        const header = event.currentTarget;
        const start = nodes.root.getBoundingClientRect();
        const offset = { x: event.clientX - start.left, y: event.clientY - start.top };
        header.setPointerCapture(event.pointerId);
        const move = (moveEvent) => place(moveEvent.clientX - offset.x, moveEvent.clientY - offset.y);
        const stop = () => {
            header.removeEventListener('pointermove', move);
            header.removeEventListener('pointerup', stop);
        };
        header.addEventListener('pointermove', move);
        header.addEventListener('pointerup', stop);
    }

    /* Put the panel's top left corner at (x, y) on screen, inside #center. */
    function place(x, y) {
        const area = document.getElementById('center').getBoundingClientRect();
        const size = nodes.root.getBoundingClientRect();
        const left = Math.min(Math.max(x, area.left), area.right - size.width) - area.left;
        const top = Math.min(Math.max(y, area.top), area.bottom - size.height) - area.top;
        nodes.root.style.left = Math.max(0, left) + 'px';
        nodes.root.style.top = Math.max(0, top) + 'px';
        nodes.root.style.right = 'auto';
    }

    /* If the panel covers the match just selected, move it below the match (above it when there is no room). */
    function keepClear(found) {
        const frame = document.getElementById('deck-frame');
        const frameRect = frame.getBoundingClientRect();
        const zoom = frameRect.width / frame.offsetWidth;
        const r = App.text.matchRange(found.element, found.match).getBoundingClientRect();
        const match = { left: frameRect.left + r.left * zoom, right: frameRect.left + r.right * zoom,
            top: frameRect.top + r.top * zoom, bottom: frameRect.top + r.bottom * zoom };
        const panel = nodes.root.getBoundingClientRect();
        if (match.right < panel.left || match.left > panel.right || match.bottom < panel.top || match.top > panel.bottom) {
            return;
        }
        const area = document.getElementById('center').getBoundingClientRect();
        const below = match.bottom + 16;
        place(panel.left, below + panel.height <= area.bottom ? below : match.top - 16 - panel.height);
    }

    function onKeyDown(event) {
        if (event.isComposing) {
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();   // not also "deselect" or the format painter's Esc
            App.findReplace.close();
        } else if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
            // As in PowerPoint, Enter is Find Next in both fields (Shift+Enter: back, as in the browser's own find).
            event.preventDefault();
            findNext(!event.shiftKey);
        }
    }

    App.findReplace.isOpen = function isOpen() {
        return !!nodes && !nodes.root.hidden;
    };

    /* Open the panel as Find ('find') or Replace ('replace'), with the cursor in "Find what". */
    App.findReplace.open = function open(mode) {
        if (!nodes) {
            build();
        }
        const replacing = mode === 'replace';
        nodes.title.textContent = replacing ? 'Replace' : 'Find';
        nodes.replaceRow.hidden = !replacing;
        nodes.replaceOne.hidden = !replacing;
        nodes.replaceAll.hidden = !replacing;
        nodes.showReplace.hidden = replacing;
        // Text selected on one line is what you are looking for (as in PowerPoint).
        const selected = App.text.isEditing() ? App.deck.getDocument().getSelection().toString() : '';
        if (selected && selected.length <= 100 && selected.indexOf('\n') === -1) {
            nodes.find.value = selected;
            note = null;
        }
        nodes.root.hidden = false;
        nodes.find.focus();
        nodes.find.select();
        scheduleRefresh();
    };

    App.findReplace.close = function close() {
        if (!App.findReplace.isOpen()) {
            return;
        }
        nodes.root.hidden = true;
        paint([]);
        App.text.refocus();   // back to typing where the last match was selected
    };

    // ---------------------------------------------------------------
    // Matches
    // ---------------------------------------------------------------

    function options() {
        return { matchCase: nodes.matchCase.checked, wholeWord: nodes.wholeWord.checked };
    }

    /* Every match in the deck in order, as { slideIndex, boxIndex, slide, element, match }. */
    function allMatches() {
        const out = [];
        if (!App.findReplace.isOpen() || !nodes.find.value || !App.deck.getDocument()) {
            return out;
        }
        App.deck.getSlides().forEach((slide, slideIndex) => {
            App.text.containersIn(slide).forEach((element, boxIndex) => {
                App.text.findMatches(element, nodes.find.value, options()).forEach((match) => {
                    out.push({ slideIndex: slideIndex, boxIndex: boxIndex, slide: slide, element: element, match: match });
                });
            });
        });
        return out;
    }

    /* Is this match the text selected in the box being edited? */
    function isSelected(found) {
        if (App.text.editingElement() !== found.element) {
            return false;
        }
        const caret = App.text.getCaret(found.element);
        const ends = caret && [caret.anchor, caret.focus].sort((a, b) => a.o - b.o);
        return !!ends && ends[0].p === found.match.p && ends[1].p === found.match.p &&
            ends[0].o === found.match.start && ends[1].o === found.match.end;
    }

    // Positions in the deck compare as [slide, box, line, character].
    function compare(a, b) {
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
                return a[i] < b[i] ? -1 : 1;
            }
        }
        return 0;
    }

    function boxIndexOf(element) {
        return App.text.containersIn(element.closest('section.slide')).indexOf(element);
    }

    /*
     * Where a search starts: the end of the selection in the box being edited
     * (its start going back), else a selected text box, else the slide shown.
     */
    function startPosition(forward) {
        const slideIndex = App.deck.getCurrentIndex();
        const editing = App.text.editingElement();
        const caret = editing && App.text.getCaret(editing);
        if (caret) {
            const [first, last] = [caret.anchor, caret.focus].sort((a, b) => a.p - b.p || a.o - b.o);
            const point = forward ? last : first;
            return [slideIndex, boxIndexOf(editing), point.p, point.o];
        }
        const element = App.selection.getElement();
        const type = element && element.getAttribute('data-type');
        // A selected table: from its first cell (forward) or its last one (back).
        const cells = type === 'table' ? App.text.containersIn(element) : [];
        const selected = type === 'text' ? element : cells[forward ? 0 : cells.length - 1];
        if (selected) {
            return forward ? [slideIndex, boxIndexOf(selected), 0, 0] : [slideIndex, boxIndexOf(selected), Infinity, 0];
        }
        return forward ? [slideIndex, -1, 0, 0] : [slideIndex + 1, -1, 0, 0];
    }

    /* Go to the next (or previous) match and select it; past the end it goes on from the other end. */
    function findNext(forward) {
        note = null;
        const matches = allMatches();
        if (matches.length === 0) {
            refresh();
            return;
        }
        const from = startPosition(forward);
        const startOf = (m) => [m.slideIndex, m.boxIndex, m.match.p, m.match.start];
        const endOf = (m) => [m.slideIndex, m.boxIndex, m.match.p, m.match.end];
        let found = forward ? matches.find((m) => compare(startOf(m), from) >= 0)
            : matches.slice().reverse().find((m) => compare(endOf(m), from) <= 0);
        if (!found) {
            found = forward ? matches[0] : matches[matches.length - 1];
            note = { text: forward ? 'continued from the first slide' : 'continued from the last slide', alone: false };
        }
        show(found);
    }

    function show(found) {
        const focused = document.activeElement;
        if (App.deck.getCurrentIndex() !== found.slideIndex) {
            App.deck.goTo(found.slideIndex);
        }
        App.text.selectMatch(found.element, found.match);
        keepClear(found);
        if (focused && nodes.root.contains(focused)) {
            focused.focus();   // editing took the focus into the slide; the panel keeps the keyboard
        }
        refresh();
    }

    /* Replace: the selected match is replaced (one undo step), then Find Next; with none selected, only Find Next. */
    function replaceOne() {
        const selected = allMatches().find(isSelected);
        if (selected) {
            App.text.replaceText(selected.element, [selected.match], nodes.replace.value);
        }
        findNext(true);   // from after the replacement, so a replacement holding the search word is not found again
    }

    /* Replace All: every match on every slide, as one undo step for the whole deck. */
    function replaceAll() {
        App.text.exitEdit();   // its text is normalized first, so the matches found below stay valid
        const matches = allMatches();
        if (matches.length > 0) {
            const byBox = new Map();
            matches.forEach((m) => byBox.set(m.element, (byBox.get(m.element) || { slide: m.slide, list: [] })));
            matches.forEach((m) => byBox.get(m.element).list.push(m.match));
            App.history.change('Replace All', 'deck', () => byBox.forEach((box, element) => {
                App.text.replaceAll(element, box.list, nodes.replace.value);
                App.deck.withSlideShown(box.slide, () => App.text.fitBox(element));   // autofit / table rows measure the box
            }));
            App.selection.refresh();
        }
        note = matches.length === 0 ? null : { text: 'Replaced ' + matches.length, alone: true };
        refresh();
    }

    // ---------------------------------------------------------------
    // Highlights and the count
    // ---------------------------------------------------------------

    /* Paint `matches` in the deck (the selected one in another colour); [] clears them. */
    function paint(matches) {
        const doc = App.deck.getDocument();
        const view = doc && doc.defaultView;
        if (!view || !view.CSS || !view.CSS.highlights) {
            return;   // no Highlight API (not Chromium 105+): Find still works, without the colours
        }
        const all = new view.Highlight();
        const current = new view.Highlight();
        matches.forEach((found) => (isSelected(found) ? current : all).add(App.text.matchRange(found.element, found.match)));
        view.CSS.highlights.set('editor-find', all);
        view.CSS.highlights.set('editor-find-current', current);
    }

    function refresh() {
        if (!App.findReplace.isOpen()) {
            return;
        }
        const matches = allMatches();
        paint(matches);
        const index = matches.findIndex(isSelected);
        let count = '';
        if (nodes.find.value) {
            count = matches.length === 0 ? 'No matches'
                : index !== -1 ? (index + 1) + ' of ' + matches.length
                    : matches.length + (matches.length === 1 ? ' match' : ' matches');
        }
        nodes.status.textContent = note && note.alone ? note.text : [count, note && note.text].filter(Boolean).join(' · ');
    }

    /* At most once per frame: the deck or the cursor may change many times in a row. */
    function scheduleRefresh() {
        if (!refreshFrame) {
            refreshFrame = requestAnimationFrame(() => {
                refreshFrame = 0;
                refresh();
            });
        }
    }

    App.findReplace.init = function init() {
        ['history-changed', 'slide-changed', 'text-selection-changed', 'text-edit-changed'].forEach((name) =>
            App.events.on(name, scheduleRefresh));
        App.events.on('deck-loaded', () => App.findReplace.close());
    };
})();
