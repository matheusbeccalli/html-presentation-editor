/*
 * groups.js - group / ungroup (SPEC Phase 7; Ctrl+G / Ctrl+Shift+G).
 *
 * A group is an element of its own that holds its parts (SPEC 3.3, element
 * type "group"):
 *
 *   <div class="el" data-type="group" data-id="e9" style="left: 100px; top: 200px; width: 500px; height: 200px; z-index: 2;">
 *     <div class="el" data-type="text" data-id="e2" style="left: 0px; top: 0px; …; z-index: 1;">…</div>
 *     <div class="el" data-type="shape" data-id="e3" style="left: 400px; top: 100px; …; z-index: 2;">…</div>
 *   </div>
 *
 * The parts are measured from the group's top left corner, so a group moves
 * as one by changing only its own left / top. Resizing it scales every part
 * (their text keeps its size, as in PowerPoint). Groups can hold groups.
 * The deck's <style data-deck-groups> (GROUP_CSS, added on open by
 * importer.js) places the parts inside their group.
 *
 * On the slide a group is one element: selection, snapping, align, copy /
 * paste, delete and the stacking order see only the outermost group.
 * Double-clicking text inside a group types in that part (selection.js).
 * A group can be turned like any element (its parts turn with it); ungrouping
 * a turned group leaves each part where it shows, turned as much.
 *
 * The maths and the slide operations at the top are tested in
 * tests/unit/groups.test.js (no page state).
 *
 * Talks to: transform.js, selection.js, history.js, deck.js, elements.js (fresh ids).
 */

(function () {
    'use strict';

    App.groups = {};

    App.groups.GROUP_CSS = '.el[data-type="group"] > .el { position: absolute; box-sizing: border-box; }\n';

    const hundredths = (value) => Math.round(value * 100) / 100;

    // ---------------------------------------------------------------
    // Pure helpers
    // ---------------------------------------------------------------

    /* The box around `rects`, and each rect measured from its top left corner. */
    App.groups.layout = function layout(rects) {
        const bounds = App.transform.boundsOf(rects);
        return {
            bounds: bounds,
            inner: rects.map((rect) => ({ left: rect.left - bounds.left, top: rect.top - bounds.top, width: rect.width, height: rect.height })),
        };
    };

    /* A part's rect when its group is scaled by sx across and sy down (the corner stays at 0, 0). */
    App.groups.scaleRect = function scaleRect(rect, sx, sy) {
        return { left: hundredths(rect.left * sx), top: hundredths(rect.top * sy),
            width: hundredths(rect.width * sx), height: hundredths(rect.height * sy) };
    };

    // ---------------------------------------------------------------
    // Groups in a slide (DOM, no page state)
    // ---------------------------------------------------------------

    App.groups.isGroup = function isGroup(element) {
        return Boolean(element && element.classList && element.classList.contains('el') &&
            element.getAttribute('data-type') === 'group');
    };

    /* The element as the slide sees it: the outermost group it is in, or itself. */
    App.groups.topOf = function topOf(element) {
        let top = element;
        while (top && App.groups.isGroup(top.parentElement)) {
            top = top.parentElement;
        }
        return top;
    };

    /* z-index 1, 2, 3 … in `order` (back to front). */
    function renumber(order) {
        order.forEach((element, index) => {
            element.style.zIndex = String(index + 1);
        });
    }

    /*
     * Wrap `elements` (on `slide`, not in a group) in a new group with this
     * data-id. It takes the place of the topmost of them in the stack; inside,
     * they keep their order. Returns the group.
     */
    App.groups.makeGroup = function makeGroup(slide, elements, id) {
        const order = App.transform.topLevelElements(slide);
        const parts = order.filter((element) => elements.indexOf(element) !== -1);
        const topmost = parts[parts.length - 1];
        const rects = parts.map(App.transform.readRect);
        // The group's box is round what shows: a turned part's corners stay inside it.
        const bounds = App.transform.boundsOf(parts.map((part, i) => App.transform.visualRect(rects[i], App.transform.rotationOf(part))));
        const inner = rects.map((rect) => ({ left: hundredths(rect.left - bounds.left), top: hundredths(rect.top - bounds.top),
            width: rect.width, height: rect.height }));
        const group = slide.ownerDocument.createElement('div');
        group.className = 'el';
        group.setAttribute('data-type', 'group');
        group.setAttribute('data-id', id);
        App.transform.writeRect(group, bounds);
        slide.insertBefore(group, topmost);
        parts.forEach((part, index) => {
            App.transform.writeRect(part, inner[index]);
            group.appendChild(part);
        });
        renumber(parts);
        renumber(order.filter((element) => element === topmost || parts.indexOf(element) === -1)
            .map((element) => (element === topmost ? group : element)));
        return group;
    };

    /* Put a group's parts back on its slide, in its place in the stack, in slide pixels. Returns the parts. */
    App.groups.breakGroup = function breakGroup(group) {
        const slide = group.parentElement;
        const order = App.transform.topLevelElements(slide);
        const offset = App.transform.readRect(group);
        const angle = App.transform.rotationOf(group);
        const parts = App.transform.topLevelElements(group);
        parts.forEach((part) => {
            const rect = App.transform.readRect(part);
            rect.left = hundredths(rect.left + offset.left);
            rect.top = hundredths(rect.top + offset.top);
            if (angle) {
                // A turned group: each part goes where it shows, turned as much as it looked.
                const center = App.transform.turnAbout(offset, angle, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                rect.left = hundredths(center.x - rect.width / 2);
                rect.top = hundredths(center.y - rect.height / 2);
                App.transform.setRotation(part, App.transform.rotationOf(part) + angle);
            }
            App.transform.writeRect(part, rect);
            slide.insertBefore(part, group);
        });
        group.remove();
        const index = order.indexOf(group);
        renumber(order.slice(0, index).concat(parts, order.slice(index + 1)));
        return parts;
    };

    /* The part (not a group) of `group` under slide point (x, y), the topmost one; null if none. */
    App.groups.childAt = function childAt(group, x, y) {
        const offset = App.transform.readRect(group);
        // A turned group: the point turned back, then measured from the group's corner.
        const local = App.transform.toLocal(offset, App.transform.rotationOf(group), { x: x, y: y });
        const px = local.x - offset.left;
        const py = local.y - offset.top;
        const parts = App.transform.topLevelElements(group).reverse();   // front first
        for (const part of parts) {
            const rect = App.transform.readRect(part);
            const p = App.transform.toLocal(rect, App.transform.rotationOf(part), { x: px, y: py });
            if (p.x >= rect.left && p.x <= rect.left + rect.width && p.y >= rect.top && p.y <= rect.top + rect.height) {
                return App.groups.isGroup(part) ? App.groups.childAt(part, px, py) : part;
            }
        }
        return null;
    };

    /* Every part inside `group` (groups within included) with its rect now: to scale them during a resize. */
    App.groups.partsOf = function partsOf(group) {
        return Array.from(group.querySelectorAll('.el'), (part) => ({ element: part, rect: App.transform.readRect(part) }));
    };

    /*
     * The group went from `from` to `to` (rects): scale the parts as they were
     * (`parts` from partsOf before the resize). Each level of nested groups is
     * measured from its own corner, so the same factors work at every level.
     */
    App.groups.scaleParts = function scaleParts(parts, from, to) {
        const sx = from.width ? to.width / from.width : 1;
        const sy = from.height ? to.height / from.height : 1;
        parts.forEach(({ element, rect }) => {
            App.transform.writeRect(element, App.groups.scaleRect(rect, sx, sy));
            App.text.fitText(element);
            App.tables.fitTable(element, { resized: true });
            App.shapes.render(element);
            App.charts.redraw(element);
        });
    };

    // ---------------------------------------------------------------
    // Commands
    // ---------------------------------------------------------------

    function slideScope() {
        return { slideId: App.deck.getCurrentSlide().getAttribute('data-slide-id') };
    }

    /* Not with a locked element among them: grouping would let it move with the group. */
    App.groups.canGroup = function canGroup() {
        return App.selection.count() > 1 && !App.text.isEditing() && Boolean(App.deck.getCurrentSlide()) &&
            !App.selection.getElements().some(App.elements.isLocked);
    };

    App.groups.canUngroup = function canUngroup() {
        return !App.text.isEditing() && App.selection.getElements().some((element) => App.groups.isGroup(element) &&
            !App.elements.isLocked(element));
    };

    App.groups.group = function group() {
        if (!App.groups.canGroup()) {
            return;
        }
        const slide = App.deck.getCurrentSlide();
        const elements = App.selection.getElements();
        let made = null;
        App.history.change('Group', slideScope(), () => {
            const used = new Set(Array.from(App.deck.getDocument().querySelectorAll('[data-id]'), (node) => node.getAttribute('data-id')));
            made = App.groups.makeGroup(slide, elements, App.util.uniqueId('e', used));
        });
        App.selection.select(made);
    };

    /* Ungroup every selected group; its parts end up selected, with the other selected elements. */
    App.groups.ungroup = function ungroup() {
        if (!App.groups.canUngroup()) {
            return;
        }
        const elements = App.selection.getElements();
        let selected = [];
        App.history.change('Ungroup', slideScope(), () => {
            elements.forEach((element) => {
                const breaks = App.groups.isGroup(element) && !App.elements.isLocked(element);
                selected = selected.concat(breaks ? App.groups.breakGroup(element) : [element]);
            });
        });
        App.selection.selectMany(selected);
    };
})();
