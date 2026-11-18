/*
 * selectionpane.js - the Selection Pane (Phase 10, PowerPoint's Alt+F10).
 *
 * A pane on the right listing the slide's elements, front first (the top of
 * the list is the element in front). A row:
 *   - click: selects that element (Ctrl+click or Shift+click adds it or takes
 *     it out), also one hidden behind others or hidden altogether;
 *   - the eye: hides or shows it (data-hidden="true": saved, and left out of
 *     the show, print, pictures and PowerPoint; elements.js);
 *   - double-click on the name: rename it (data-name; Enter keeps, Esc drops);
 *   - drag up or down: moves it in front of / behind the others.
 * Show All / Hide All act on the whole slide. Every change is one undo step.
 *
 * Tab / Shift+Tab on the slide (shortcuts.js, onSlide) select the next /
 * previous element back to front, going round, hidden ones left out (step).
 *
 * Talks to: elements.js (names, hidden, moveInOrder, restackSlide, stepId),
 * selection.js, history.js, transform.js (topLevelElements), events.js.
 */

(function () {
    'use strict';

    App.selectionPane = {};

    const el = (tag, attrs, children) => App.util.el(tag, attrs, children);
    const DRAG_START = 4;   // px the pointer moves before a press on a row becomes a drag

    let nodes = null;
    let renaming = null;    // the id of the element whose name is being typed
    let drag = null;        // { id, startY, active, index, line }

    App.selectionPane.isOpen = function isOpen() {
        return !!nodes && !nodes.pane.hidden;
    };

    App.selectionPane.open = function open() {
        nodes.pane.hidden = false;
        render();
        App.events.emit('selection-pane-changed', { open: true });
    };

    App.selectionPane.close = function close() {
        renaming = null;
        nodes.pane.hidden = true;
        App.events.emit('selection-pane-changed', { open: false });
    };

    App.selectionPane.toggle = function toggle() {
        if (App.selectionPane.isOpen()) {
            App.selectionPane.close();
        } else {
            App.selectionPane.open();
        }
    };

    function slideScope(slide) {
        return { slideId: slide.getAttribute('data-slide-id') };
    }

    function byId(slide, id) {
        return slide.querySelector(':scope > .el[data-id="' + CSS.escape(id) + '"]');
    }

    /* Tab (1) / Shift+Tab (-1) on the slide: the next element back to front, going round; hidden ones left out. */
    App.selectionPane.step = function step(dir) {
        const slide = App.deck.getCurrentSlide();
        if (!slide) {
            return;
        }
        const order = App.elements.pickableElements(slide).map((element) => element.getAttribute('data-id'));
        const ids = App.selection.selectedIds();
        const id = App.elements.stepId(order, ids.length === 1 ? ids[0] : null, dir);
        if (id) {
            App.selection.select(byId(slide, id));
        }
    };

    function setHidden(slide, elements, hidden) {
        const changing = elements.filter((element) => App.elements.isHidden(element) !== hidden);
        if (!changing.length) {
            return;
        }
        App.history.change(hidden ? 'Hide' : 'Show', slideScope(slide), () => {
            changing.forEach((element) => App.elements.setHidden(element, hidden));
        });
    }

    function rename(slide, id, name) {
        renaming = null;
        const element = byId(slide, id);
        const before = element ? element.getAttribute('data-name') || '' : '';
        const clean = String(name || '').replace(/\s+/g, ' ').trim();
        if (element && clean !== before) {
            App.history.change('Rename', slideScope(slide), () => App.elements.setName(element, clean));
        } else {
            render();
        }
    }

    /* A click on a row: that element alone, or (Ctrl / Shift) added to or taken out of the selection. */
    function choose(slide, id, add) {
        const element = byId(slide, id);
        if (!element) {
            return;
        }
        if (!add) {
            App.selection.select(element);
            return;
        }
        const chosen = App.selection.getElements();
        const next = chosen.indexOf(element) === -1 ? chosen.concat([element]) : chosen.filter((one) => one !== element);
        App.selection.selectMany(next);
    }

    function nameField(slide, id, name) {
        const input = el('input', { type: 'text', class: 'selection-name-input', value: name, maxlength: '60',
            'aria-label': 'Name of the element', autocomplete: 'off', spellcheck: 'false' });
        let done = false;
        input.addEventListener('keydown', (event) => {
            event.stopPropagation();   // Delete, arrows and Tab type here, not on the slide
            if (event.key === 'Enter') {
                event.preventDefault();
                done = true;
                rename(slide, id, input.value);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                done = true;
                renaming = null;
                render();
            }
        });
        input.addEventListener('blur', () => {
            if (!done) {
                done = true;
                rename(slide, id, input.value);
            }
        });
        return input;
    }

    function row(slide, element, selectedIds) {
        const id = element.getAttribute('data-id');
        const hidden = App.elements.isHidden(element);
        const name = App.elements.nameOf(element);
        const eye = el('button', {
            type: 'button', class: 'selection-eye', 'aria-pressed': String(!hidden),
            title: hidden ? 'Hidden: click to show it' : 'Click to hide it (left out of the show, print and exports)',
            'aria-label': (hidden ? 'Show ' : 'Hide ') + name,
            onclick: (event) => {
                event.stopPropagation();
                setHidden(slide, [element], !hidden);
            },
        });
        eye.innerHTML = App.icons.get(hidden ? 'eyeClosed' : 'eyeOpen');
        const label = renaming === id ? nameField(slide, id, element.getAttribute('data-name') || name)
            : el('span', { class: 'selection-name', title: name + ' (double-click to rename)' }, [name]);
        const item = el('div', {
            class: 'selection-row' + (selectedIds.indexOf(id) !== -1 ? ' selected' : '') + (hidden ? ' hidden-element' : ''),
            'data-id': id, role: 'option', 'aria-selected': String(selectedIds.indexOf(id) !== -1),
        }, [eye, label]);
        item.addEventListener('pointerdown', (event) => onRowPointerDown(event, slide, id));
        item.addEventListener('click', (event) => {
            if (event.target.closest('.selection-eye, input') || (drag && drag.moved)) {
                return;
            }
            choose(slide, id, event.ctrlKey || event.metaKey || event.shiftKey);
        });
        item.addEventListener('dblclick', (event) => {
            if (event.target.closest('.selection-eye')) {
                return;
            }
            renaming = id;
            render();
            const input = nodes.list.querySelector('.selection-name-input');
            if (input) {
                input.focus();
                input.select();
            }
        });
        return item;
    }

    // ---- Dragging a row up or down: the element moves in the stack ----

    function rows() {
        return Array.from(nodes.list.querySelectorAll('.selection-row'));
    }

    /* Where a row dropped at clientY lands: its index in the list (front first) once taken out. */
    function dropIndex(clientY, id) {
        const others = rows().filter((item) => item.getAttribute('data-id') !== id);
        const index = others.findIndex((item) => {
            const box = item.getBoundingClientRect();
            return clientY < box.top + box.height / 2;
        });
        return index === -1 ? others.length : index;
    }

    function onRowPointerDown(event, slide, id) {
        if (event.button !== 0 || event.target.closest('.selection-eye, input')) {
            return;
        }
        drag = { id: id, startY: event.clientY, active: false, moved: false, index: null, slide: slide };
        window.addEventListener('pointermove', onDragMove);
        window.addEventListener('pointerup', onDragEnd, { once: true });
    }

    function onDragMove(event) {
        if (!drag) {
            return;
        }
        if (!drag.active && Math.abs(event.clientY - drag.startY) < DRAG_START) {
            return;
        }
        drag.active = true;
        drag.index = dropIndex(event.clientY, drag.id);
        const others = rows().filter((item) => item.getAttribute('data-id') !== drag.id);
        const listBox = nodes.list.getBoundingClientRect();
        const y = others.length === 0 ? 0 : drag.index < others.length
            ? others[drag.index].getBoundingClientRect().top - listBox.top
            : others[others.length - 1].getBoundingClientRect().bottom - listBox.top;
        nodes.dropLine.hidden = false;
        nodes.dropLine.style.top = (y + nodes.list.scrollTop - 1) + 'px';
    }

    function onDragEnd() {
        window.removeEventListener('pointermove', onDragMove);
        nodes.dropLine.hidden = true;
        const ended = drag;
        if (ended && ended.active) {
            ended.moved = true;
            const slide = ended.slide;
            const ids = App.transform.topLevelElements(slide).reverse().map((element) => element.getAttribute('data-id'));
            const next = App.elements.moveInOrder(ids, ended.id, ended.index);
            if (next.join(' ') !== ids.join(' ')) {
                App.history.change('Reorder', slideScope(slide), () => App.elements.restackSlide(slide, next));
            }
        }
        setTimeout(() => {   // the click that ends a drag does not also select
            drag = null;
        }, 0);
    }

    function render() {
        if (!App.selectionPane.isOpen()) {
            return;
        }
        const slide = App.deck.getCurrentSlide();
        const elements = slide ? App.transform.topLevelElements(slide).reverse() : [];   // front first
        const selectedIds = App.selection.selectedIds();
        nodes.list.replaceChildren(...elements.map((element) => row(slide, element, selectedIds)), nodes.dropLine);
        nodes.empty.hidden = elements.length > 0;
        nodes.showAll.disabled = !elements.some(App.elements.isHidden);
        nodes.hideAll.disabled = !elements.some((element) => !App.elements.isHidden(element));
    }

    App.selectionPane.render = render;

    App.selectionPane.init = function init() {
        nodes = {
            pane: document.getElementById('selection-pane'),
            list: document.getElementById('selection-list'),
            empty: document.getElementById('selection-empty'),
            showAll: document.getElementById('selection-show-all'),
            hideAll: document.getElementById('selection-hide-all'),
            dropLine: el('div', { class: 'selection-drop-line', hidden: true }),
        };
        document.getElementById('selection-close').addEventListener('click', () => App.selectionPane.close());
        nodes.showAll.addEventListener('click', () => {
            const slide = App.deck.getCurrentSlide();
            if (slide) {
                setHidden(slide, App.transform.topLevelElements(slide), false);
            }
        });
        nodes.hideAll.addEventListener('click', () => {
            const slide = App.deck.getCurrentSlide();
            if (slide) {
                setHidden(slide, App.transform.topLevelElements(slide), true);
            }
        });
        ['deck-loaded', 'slide-changed', 'history-changed', 'selection-changed'].forEach((name) => App.events.on(name, () => {
            if (name !== 'selection-changed') {
                renaming = null;
            }
            render();
        }));
    };
})();
